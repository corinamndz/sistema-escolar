const { ApiError } = require('../../utils/ApiError');

// ---------- Lapsos/periodos ----------

async function listTerms(trx, tenantId, { schoolPeriodId } = {}) {
  const query = trx('terms').where({ tenant_id: tenantId }).orderBy('start_date');
  if (schoolPeriodId) query.andWhere({ school_period_id: schoolPeriodId });
  return query;
}

async function createTerm(trx, tenantId, { schoolPeriodId, name, startDate, endDate }) {
  const [term] = await trx('terms')
    .insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, name, start_date: startDate, end_date: endDate })
    .returning('*');
  return term;
}

// ---------- Planes de evaluación ----------

async function listPlans(trx, tenantId, { sectionId, termId, teacherId } = {}) {
  const query = trx('evaluation_plans as ep')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('staff as st', 'st.id', 'ep.teacher_id')
    .where('ep.tenant_id', tenantId)
    .select(
      'ep.*',
      'sec.name as section_name',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      't.name as term_name',
      trx.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
      // Avance del plan: cuántas actividades tiene y cuánto suman sus porcentajes.
      trx.raw('(SELECT count(*)::int FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS activity_count'),
      trx.raw('(SELECT COALESCE(sum(a.weight_percent), 0)::float FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS total_weight')
    )
    .orderBy('ep.created_at', 'desc');
  if (sectionId) query.andWhere('ep.section_id', sectionId);
  if (termId) query.andWhere('ep.term_id', termId);
  if (teacherId) query.andWhere('ep.teacher_id', teacherId);
  return query;
}

async function getPlanWithActivities(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .select('ep.*', 't.name as term_name', 't.start_date as term_start', 't.end_date as term_end')
    .first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .orderByRaw('planned_date ASC NULLS LAST, created_at ASC');

  // Redondeo a centésimas: los porcentajes son NUMERIC(5,2) y 33.33 + 33.33 + 33.34 debe dar 100.
  const totalWeight = Math.round(activities.reduce((sum, a) => sum + Number(a.weight_percent), 0) * 100) / 100;

  const project = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();

  let competencies = [];
  if (project) {
    competencies = await trx('project_competencies')
      .where({ tenant_id: tenantId, pedagogical_project_id: project.id });
  }

  return { ...plan, activities, totalWeight, pedagogicalProject: project ? { ...project, competencies } : null };
}

/**
 * Crea un plan de evaluación respetando la asignación docente del nivel:
 *  - Secundaria: `subjectId` obligatorio; la materia debe tener profesor
 *    asignado en la sección y el plan queda a nombre de ese profesor.
 *  - Inicial / Primaria: `subject` es un área de texto libre y el docente
 *    debe ser el titular o el auxiliar de la sección.
 */
async function createPlan(trx, tenantId, { sectionId, termId, teacherId: requestedTeacherId, subject: subjectText, subjectId }) {
  const section = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'sec.id': sectionId, 'sec.tenant_id': tenantId })
    .select('sec.*', 'g.name as grade_name', 'el.name as level_name', 'el.assignment_mode')
    .first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');

  const term = await trx('terms').where({ id: termId, tenant_id: tenantId }).first();
  if (!term || term.school_period_id !== section.school_period_id) {
    throw ApiError.badRequest('El lapso no pertenece al año escolar de la sección.', [{ path: 'termId', message: 'Lapso inválido.' }]);
  }

  let teacherId = requestedTeacherId;
  let subject = subjectText?.trim();

  if (section.assignment_mode === 'subjects') {
    if (!subjectId) {
      throw ApiError.badRequest(`En ${section.level_name} el plan debe asociarse a una materia del plan de estudios.`, [
        { path: 'subjectId', message: 'Selecciona la materia.' },
      ]);
    }
    const assignment = await trx('teacher_subject_sections as t')
      .join('subjects as s', 's.id', 't.subject_id')
      .join('staff as st', 'st.id', 't.staff_id')
      .where({ 't.section_id': sectionId, 't.subject_id': subjectId })
      .select('s.name as subject_name', 't.staff_id', 'st.first_name', 'st.last_name')
      .first();
    if (!assignment) {
      throw ApiError.unprocessable('Esa materia no tiene profesor asignado en esta sección. Asígnalo primero.', [
        { path: 'subjectId', message: 'Sin profesor asignado.' },
      ]);
    }
    if (teacherId && teacherId !== assignment.staff_id) {
      throw ApiError.unprocessable(
        `${assignment.subject_name} en esta sección está asignada a ${assignment.first_name} ${assignment.last_name}.`,
        [{ path: 'teacherId', message: 'No es el profesor asignado.' }]
      );
    }
    teacherId = assignment.staff_id;
    subject = assignment.subject_name;
  } else {
    if (!subject) {
      throw ApiError.badRequest('Indica el área o asignatura del plan.', [{ path: 'subject', message: 'Requerido.' }]);
    }
    const homeroom = await trx('teacher_sections').where({ section_id: sectionId }).pluck('staff_id');
    if (homeroom.length === 0) {
      throw ApiError.unprocessable('Esta sección no tiene docente asignado. Asígnalo antes de crear planes.');
    }
    if (!teacherId || !homeroom.includes(teacherId)) {
      throw ApiError.unprocessable('El docente debe ser el titular o el auxiliar de la sección.', [
        { path: 'teacherId', message: 'No está asignado a esta sección.' },
      ]);
    }
  }

  const existing = await trx('evaluation_plans')
    .where({ tenant_id: tenantId, section_id: sectionId, term_id: termId, teacher_id: teacherId, subject })
    .first();
  if (existing) {
    throw ApiError.conflict('Ya existe un plan de evaluación para esta sección, lapso, docente y asignatura.');
  }

  const [plan] = await trx('evaluation_plans')
    .insert({
      tenant_id: tenantId,
      section_id: sectionId,
      term_id: termId,
      teacher_id: teacherId,
      subject,
      subject_id: section.assignment_mode === 'subjects' ? subjectId : null,
    })
    .returning('*');
  return plan;
}

// ---------- Proyectos pedagógicos y competencias ----------

async function createPedagogicalProject(trx, tenantId, planId, { title, description, competencies = [] }) {
  await getPlanWithActivities(trx, tenantId, planId); // valida que el plan exista

  const existing = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();
  if (existing) throw ApiError.conflict('Este plan ya tiene un proyecto pedagógico.');

  const [project] = await trx('pedagogical_projects')
    .insert({ tenant_id: tenantId, evaluation_plan_id: planId, title, description })
    .returning('*');

  if (competencies.length > 0) {
    await trx('project_competencies').insert(
      competencies.map((description) => ({
        tenant_id: tenantId,
        pedagogical_project_id: project.id,
        description,
      }))
    );
  }

  const createdCompetencies = await trx('project_competencies').where({ pedagogical_project_id: project.id });
  return { ...project, competencies: createdCompetencies };
}

async function addCompetency(trx, tenantId, projectId, { description }) {
  const project = await trx('pedagogical_projects').where({ id: projectId, tenant_id: tenantId }).first();
  if (!project) throw ApiError.notFound('Proyecto pedagógico no encontrado.');

  const [competency] = await trx('project_competencies')
    .insert({ tenant_id: tenantId, pedagogical_project_id: projectId, description })
    .returning('*');
  return competency;
}

// ---------- Actividades de evaluación (con la validación crítica del 100%) ----------

/**
 * Crea o actualiza una actividad de evaluación, validando que la sumatoria
 * de `weight_percent` de TODAS las actividades del plan (excluyendo la que
 * se está editando) más la nueva no supere 100.
 *
 * `forUpdate()` bloquea las filas de actividades del plan hasta que la
 * transacción de este request termine (commit/rollback lo hace
 * tenant.middleware al final del request), así que si dos docentes intentan
 * agregar actividades al mismo plan al mismo tiempo, la segunda espera a que
 * la primera transacción cierre antes de leer el total — evitando que ambas
 * lean "40% usado" y las dos agreguen 70% sin verse.
 *
 * Como red de seguridad adicional existe un CONSTRAINT TRIGGER en la base de
 * datos (migrations/001_init.sql) que rechaza el INSERT/UPDATE si, por
 * cualquier vía, la suma igual queda por encima de 100.
 */
/** El plan debe existir y estar ABIERTO para modificar sus actividades. Bloquea la fila del plan. */
async function getOpenPlan(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .select('ep.*', 't.name as term_name', 't.start_date as term_start', 't.end_date as term_end')
    .forUpdate('ep')
    .first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
  if (plan.status === 'closed') {
    throw ApiError.conflict('El plan de evaluación está cerrado. Reábrelo para modificar sus actividades.');
  }
  return plan;
}

/** "Primer Lapso (del 2026-09-14 al 2026-12-18)" para mensajes de fecha fuera de rango. */
function termRange(plan) {
  if (plan.term_start && plan.term_end) return plan.term_name + ' (del ' + plan.term_start + ' al ' + plan.term_end + ')';
  if (plan.term_start) return plan.term_name + ' (desde el ' + plan.term_start + ')';
  if (plan.term_end) return plan.term_name + ' (hasta el ' + plan.term_end + ')';
  return plan.term_name;
}

async function upsertActivity(trx, tenantId, planId, { activityId, title, category, weightPercent, description, plannedDate }) {
  if (weightPercent <= 0 || weightPercent > 100) {
    throw ApiError.badRequest('El porcentaje debe estar entre 0 (exclusivo) y 100.');
  }

  const plan = await getOpenPlan(trx, tenantId, planId);

  // La fecha estimada debe caer dentro del lapso (si el lapso tiene fechas).
  if (plannedDate && ((plan.term_start && plannedDate < plan.term_start) || (plan.term_end && plannedDate > plan.term_end))) {
    throw ApiError.unprocessable('La fecha estimada debe estar dentro de ' + termRange(plan) + '.', [
      { path: 'plannedDate', message: 'Fuera del lapso.' },
    ]);
  }

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .forUpdate();

  if (activityId) {
    const exists = activities.find((a) => a.id === activityId);
    if (!exists) throw ApiError.notFound('Actividad no encontrada en este plan.');
  }

  const currentTotal = activities
    .filter((a) => a.id !== activityId)
    .reduce((sum, a) => sum + Number(a.weight_percent), 0);

  const newTotal = Math.round((currentTotal + Number(weightPercent)) * 100) / 100;

  if (newTotal > 100) {
    throw ApiError.unprocessable(
      `La suma de porcentajes excede 100%. Actual: ${currentTotal}%, intentando ${activityId ? 'actualizar a' : 'agregar'} ${weightPercent}% (total ${newTotal}%).`,
      { currentTotal, attempted: weightPercent, newTotal }
    );
  }

  if (activityId) {
    const [updated] = await trx('evaluation_activities')
      .where({ id: activityId, tenant_id: tenantId })
      .update({ title, category, weight_percent: weightPercent, description: description ?? null, planned_date: plannedDate ?? null })
      .returning('*');
    // `activity_scores.weighted_score` guarda (nota / máximo) × porcentaje: si cambia
    // el porcentaje hay que recalcularlo, o el acumulado de los alumnos queda desfasado.
    await trx('activity_scores')
      .where({ tenant_id: tenantId, evaluation_activity_id: activityId })
      .update({ weighted_score: trx.raw('(raw_score / max_score) * ?', [weightPercent]) });
    return updated;
  }

  const [created] = await trx('evaluation_activities')
    .insert({
      tenant_id: tenantId,
      evaluation_plan_id: planId,
      title,
      category,
      weight_percent: weightPercent,
      description: description ?? null,
      planned_date: plannedDate ?? null,
    })
    .returning('*');
  return created;
}

async function deleteActivity(trx, tenantId, planId, activityId) {
  await getOpenPlan(trx, tenantId, planId);
  // Debe pertenecer al plan de la URL (antes se podía borrar la actividad de otro plan).
  const activity = await trx('evaluation_activities')
    .where({ id: activityId, tenant_id: tenantId, evaluation_plan_id: planId })
    .first();
  if (!activity) throw ApiError.notFound('Actividad no encontrada en este plan.');

  const hasScores = await trx('activity_scores').where({ evaluation_activity_id: activityId }).first();
  if (hasScores) {
    throw ApiError.conflict('No se puede eliminar: ya hay calificaciones registradas para esta actividad.');
  }

  await trx('evaluation_activities').where({ id: activityId }).delete();
}

/**
 * Cierra el plan: solo si sus actividades suman EXACTAMENTE 100%. Cerrado, las
 * actividades quedan bloqueadas (las notas se siguen cargando con normalidad).
 */
async function closePlan(trx, tenantId, planId) {
  await getOpenPlan(trx, tenantId, planId);
  const { rows } = await trx.raw(
    'SELECT COALESCE(sum(weight_percent), 0)::numeric(6,2) AS total, count(*)::int AS n FROM evaluation_activities WHERE evaluation_plan_id = ?',
    [planId]
  );
  const total = Number(rows[0].total);
  if (rows[0].n === 0) throw ApiError.unprocessable('No se puede cerrar un plan sin actividades.');
  if (total !== 100) {
    const missing = Math.round((100 - total) * 100) / 100;
    throw ApiError.unprocessable(
      'No se puede cerrar: las actividades suman ' + total + '%. Faltan ' + missing + '% para llegar a 100%.',
      { total }
    );
  }
  await trx('evaluation_plans').where({ id: planId }).update({ status: 'closed', closed_at: trx.fn.now() });
  return getPlanWithActivities(trx, tenantId, planId);
}

async function reopenPlan(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
  if (plan.status !== 'closed') throw ApiError.conflict('El plan ya está abierto.');
  await trx('evaluation_plans').where({ id: planId }).update({ status: 'open', closed_at: null });
  return getPlanWithActivities(trx, tenantId, planId);
}

module.exports = {
  closePlan,
  reopenPlan,
  listTerms,
  createTerm,
  listPlans,
  getPlanWithActivities,
  createPlan,
  createPedagogicalProject,
  addCompetency,
  upsertActivity,
  deleteActivity,
};
