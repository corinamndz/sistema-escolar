const { ApiError } = require('../../utils/ApiError');

/**
 * Eliminación de un AÑO ESCOLAR con todo lo que depende de él.
 *
 * Corre dentro de la transacción del request (tenant.middleware: COMMIT si
 * todo sale bien, ROLLBACK ante cualquier error), así que o se borra todo o
 * no se borra nada.
 *
 * Se borra en un orden explícito, no solo confiando en las cascadas, porque
 * hay relaciones que un DELETE en cascada simple haría fallar (error 500):
 *   - indicator_scores → evaluation_indicators es RESTRICT;
 *   - class_schedules  → time_slots es RESTRICT;
 *   - student_sanctions → school_periods es RESTRICT;
 *   - los triggers de planes CERRADOS impiden borrar sus actividades,
 *     criterios o fechas mientras el plan exista: por eso se borran primero
 *     los planes (sin el plan, los triggers permiten la cascada).
 *
 * Qué pasa con cada cosa:
 *   Se ELIMINA: planes de evaluación (actividades, notas, indicadores,
 *   proyectos y competencias), horario (clases y bloques), sanciones del año,
 *   secciones (inscripciones, carga docente, resultados de promoción), lapsos,
 *   tarifas de mensualidad y los cobros pendientes o anulados no pagados ni
 *   reportados.
 *   Se CONSERVA: alumnos, representantes, personal, grados y materias (son
 *   del colegio, no del año) y los pagos ya registrados (pagados, reportados
 *   con comprobante, reembolsados…): son historial financiero y quedan sin
 *   año asociado (las mensualidades pasan a pagos sueltos, ver paso 3).
 */

/** Planes del año: los de sus lapsos y los de sus secciones. */
const plansOf = (trx, tenantId, periodId) =>
  trx('evaluation_plans as ep')
    .where('ep.tenant_id', tenantId)
    .andWhere((q) =>
      q
        .whereIn('ep.term_id', trx('terms').where({ school_period_id: periodId }).select('id'))
        .orWhereIn('ep.section_id', trx('sections').where({ school_period_id: periodId }).select('id'))
    )
    .select('ep.id');

/**
 * Cobros que se eliminan: pendientes o anulados que nadie pagó ni reportó
 * (sin comprobante): no hubo dinero de por medio.
 */
const pendingChargesOf = (trx, tenantId, periodId) =>
  trx('payments')
    .where({ tenant_id: tenantId, school_period_id: periodId })
    .whereIn('status', ['pending', 'cancelled'])
    .whereNull('reported_at')
    .whereNull('proof_path');

async function loadPeriod(trx, tenantId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  return period;
}

const count = async (q) => Number((await q.count('* as n').first()).n);

/** Qué se eliminaría (y qué se conserva) al borrar el año: para el modal de confirmación. */
async function getDeletionImpact(trx, tenantId, periodId) {
  const period = await loadPeriod(trx, tenantId, periodId);
  const sectionIds = trx('sections').where({ tenant_id: tenantId, school_period_id: periodId }).select('id');
  const planIds = plansOf(trx, tenantId, periodId);
  const activityIds = trx('evaluation_activities').whereIn('evaluation_plan_id', plansOf(trx, tenantId, periodId)).select('id');

  const impact = {
    sections: await count(trx('sections').where({ tenant_id: tenantId, school_period_id: periodId })),
    students: Number(
      (await trx('enrollments').whereIn('section_id', sectionIds).countDistinct('student_id as n').first()).n
    ),
    enrollments: await count(trx('enrollments').whereIn('section_id', trx('sections').where({ school_period_id: periodId }).select('id'))),
    evaluation_plans: await count(trx('evaluation_plans').whereIn('id', planIds)),
    activities: await count(trx('evaluation_activities').whereIn('evaluation_plan_id', plansOf(trx, tenantId, periodId))),
    scores:
      (await count(trx('activity_scores').whereIn('evaluation_activity_id', activityIds))) +
      (await count(trx('competency_assessments').whereIn('project_competency_id', trx('project_competencies as pc').join('pedagogical_projects as pp', 'pp.id', 'pc.pedagogical_project_id').whereIn('pp.evaluation_plan_id', plansOf(trx, tenantId, periodId)).select('pc.id')))),
    schedule_classes: await count(trx('class_schedules').whereIn('section_id', trx('sections').where({ school_period_id: periodId }).select('id'))),
    time_slots: await count(trx('time_slots').where({ tenant_id: tenantId, school_period_id: periodId })),
    sanctions: await count(trx('student_sanctions').where({ tenant_id: tenantId, school_period_id: periodId })),
    terms: await count(trx('terms').where({ tenant_id: tenantId, school_period_id: periodId })),
    tuition_fees: await count(trx('tuition_fees').where({ tenant_id: tenantId, school_period_id: periodId })),
    pending_charges: await count(pendingChargesOf(trx, tenantId, periodId)),
    // Se conservan (historial financiero), sin año asociado.
    kept_payments: await count(
      trx('payments')
        .where({ tenant_id: tenantId, school_period_id: periodId })
        .whereNotIn('id', pendingChargesOf(trx, tenantId, periodId).select('id'))
    ),
  };
  const others = await trx('school_periods').where({ tenant_id: tenantId }).whereNot('id', periodId).count('* as n').first();
  return {
    school_period: { id: period.id, name: period.name, is_active: period.is_active, closed: Boolean(period.closed_at) },
    impact,
    is_last: Number(others.n) === 0,
  };
}

/**
 * Elimina el año escolar y sus dependencias. `confirmName` debe coincidir con
 * el nombre del año (sin distinguir mayúsculas ni espacios de los extremos):
 * la misma comprobación que pide el modal, también exigida por el servidor.
 */
async function deleteSchoolPeriod(trx, tenantId, periodId, { confirmName }) {
  const before = await getDeletionImpact(trx, tenantId, periodId);
  const { school_period: period } = before;
  if (String(confirmName || '').trim().toLowerCase() !== period.name.trim().toLowerCase()) {
    throw ApiError.badRequest(`Para confirmar, escribe exactamente el nombre del año escolar: ${period.name}.`, [
      { path: 'confirmName', message: 'No coincide con el nombre del año.' },
    ]);
  }
  // Evita que otra operación cree datos en el año mientras se borra.
  await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).forUpdate().first();

  const sections = trx('sections').where({ tenant_id: tenantId, school_period_id: periodId }).select('id');
  const planIds = (await plansOf(trx, tenantId, periodId)).map((p) => p.id);

  // 1) Notas por indicador (RESTRICT hacia los indicadores) y luego los planes:
  //    al desaparecer el plan, la cascada borra actividades, notas, criterios,
  //    indicadores, fechas por sección, proyectos y competencias sin chocar con
  //    los triggers de planes cerrados.
  if (planIds.length) {
    await trx('indicator_scores')
      .whereIn('activity_id', trx('evaluation_activities').whereIn('evaluation_plan_id', planIds).select('id'))
      .delete();
    await trx('evaluation_plans').whereIn('id', planIds).delete();
  }
  // 2) Horario (RESTRICT hacia los bloques) y sanciones del año (RESTRICT hacia el año).
  await trx('class_schedules').where({ tenant_id: tenantId }).whereIn('section_id', sections).delete();
  await trx('student_sanctions').where({ tenant_id: tenantId, school_period_id: periodId }).delete();
  // 3) Cobros pendientes sin pagar ni reportar (los pagos registrados se conservan).
  await pendingChargesOf(trx, tenantId, periodId).delete();
  //    Los pagos que se conservan y eran mensualidades pasan a ser pagos sueltos
  //    ('other'): una mensualidad exige año escolar (CHECK payments_tuition_fields),
  //    así que sin este paso el SET NULL de la cascada haría fallar todo el borrado.
  //    Conservan monto, concepto ("Mensualidad Marzo…"), estado, comprobante y recibo.
  //    Además se desvinculan aquí mismo del año y de sus inscripciones (en vez de
  //    confiar en el SET NULL de la cascada, que con la seguridad por filas del
  //    rol de la aplicación termina en error de llave foránea).
  const enrollmentIds = trx('enrollments').whereIn('section_id', sections).select('id');
  await trx('payments')
    .where({ tenant_id: tenantId })
    .andWhere((q) => q.where('school_period_id', periodId).orWhereIn('enrollment_id', enrollmentIds))
    .update({ kind: 'other', school_period_id: null, enrollment_id: null });
  //    Promoción: inscripciones de OTRO año que apuntan a las de este como "siguiente".
  await trx('enrollments').where({ tenant_id: tenantId }).whereIn('next_enrollment_id', enrollmentIds).update({ next_enrollment_id: null });
  // 4) El año: la cascada borra secciones (inscripciones, carga docente,
  //    resultados de promoción), lapsos, bloques horarios y tarifas; los pagos
  //    conservados quedan con school_period_id y enrollment_id en NULL.
  await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).delete();

  return { deleted: true, ...before };
}

module.exports = { getDeletionImpact, deleteSchoolPeriod };
