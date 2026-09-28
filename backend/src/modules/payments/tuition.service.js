const { ApiError } = require('../../utils/ApiError');

/**
 * Mensualidades automáticas.
 *
 * Reglas:
 *  - Se factura cada mes del año escolar, desde el mes de inicio (o el de la
 *    inscripción, si el alumno entró más tarde) hasta el mes de fin.
 *  - Mes normal: emisión el día 1, vencimiento el día `due_day` (5 por defecto).
 *  - Primer mes de una inscripción hecha a mitad de mes: se emite el día de la
 *    inscripción y vence `due_day` días después (para que no nazca vencida).
 *  - Monto: tarifa del nivel del grado en ese año escolar o, si no hay, la
 *    tarifa general del año. El monto se copia al pago (un cambio de tarifa
 *    posterior no altera cobros ya generados).
 *  - Responsable: el representante principal del alumno (o el primero).
 *  - Idempotente: el índice único (alumno, año, mes) impide duplicados; volver
 *    a generar solo crea lo que falta y reactiva meses anulados.
 *
 * Todo en una sentencia SQL por conjuntos (generate_series), no un INSERT por mes.
 */

const MONTH_NAMES_SQL =
  "(ARRAY['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'])";

/**
 * Filtro de alcance común (todos opcionales): por inscripción, alumno, año
 * escolar o representante (sus alumnos vinculados).
 */
function scopeSql(alias = 'e') {
  return `
    ${alias}.tenant_id = ?
    AND (CAST(? AS uuid) IS NULL OR ${alias}.id = CAST(? AS uuid))
    AND (CAST(? AS uuid) IS NULL OR ${alias}.student_id = CAST(? AS uuid))
    AND (CAST(? AS uuid) IS NULL OR sec.school_period_id = CAST(? AS uuid))
    AND (CAST(? AS uuid) IS NULL OR EXISTS (
      SELECT 1 FROM student_guardians sgs
      WHERE sgs.student_id = ${alias}.student_id AND sgs.guardian_id = CAST(? AS uuid)
    ))`;
}
const scopeBindings = (tenantId, { enrollmentId = null, studentId = null, schoolPeriodId = null, guardianId = null }) => [
  tenantId,
  enrollmentId,
  enrollmentId,
  studentId,
  studentId,
  schoolPeriodId,
  schoolPeriodId,
  guardianId,
  guardianId,
];

const FEE_LATERAL = `
  SELECT tf.amount, tf.currency, tf.due_day
  FROM tuition_fees tf
  WHERE tf.tenant_id = e.tenant_id
    AND tf.school_period_id = sp.id
    AND (tf.level_code = g.level_code OR tf.level_code IS NULL)
  ORDER BY tf.level_code NULLS LAST
  LIMIT 1`;

const GUARDIAN_LATERAL = `
  SELECT sg.guardian_id
  FROM student_guardians sg
  JOIN guardians gu ON gu.id = sg.guardian_id
  WHERE sg.student_id = e.student_id
  ORDER BY sg.is_primary DESC, gu.last_name, gu.first_name
  LIMIT 1`;

/**
 * Genera (o completa) las mensualidades de las inscripciones activas en el
 * alcance indicado. Devuelve cuántas se crearon, cuántas se reactivaron y qué
 * inscripciones se omitieron y por qué.
 */
async function generateTuition(trx, tenantId, scope = {}) {
  const { rows } = await trx.raw(
    `
    WITH candidates AS (
      SELECT e.id AS enrollment_id, e.student_id, e.enrolled_at, sp.id AS school_period_id,
             sp.start_date, sp.end_date, f.amount, f.currency, f.due_day, gd.guardian_id
      FROM enrollments e
      JOIN sections sec ON sec.id = e.section_id
      JOIN grades g ON g.id = sec.grade_id
      JOIN school_periods sp ON sp.id = sec.school_period_id
      JOIN LATERAL (${FEE_LATERAL}) f ON true
      JOIN LATERAL (${GUARDIAN_LATERAL}) gd ON true
      WHERE ${scopeSql()}
        AND e.status = 'active'
        AND sp.start_date IS NOT NULL AND sp.end_date IS NOT NULL
    ),
    months AS (
      SELECT c.*, m::date AS billing_month, GREATEST(m::date, c.enrolled_at) AS issue_date
      FROM candidates c
      CROSS JOIN LATERAL generate_series(
        date_trunc('month', GREATEST(c.start_date, c.enrolled_at)),
        date_trunc('month', c.end_date),
        interval '1 month'
      ) AS m
    )
    INSERT INTO payments (
      tenant_id, student_id, guardian_id, kind, enrollment_id, school_period_id,
      billing_month, issue_date, due_date, period_label, amount, currency
    )
    SELECT ?, student_id, guardian_id, 'tuition', enrollment_id, school_period_id,
           billing_month, issue_date,
           CASE WHEN issue_date = billing_month
                THEN billing_month + (due_day - 1)
                ELSE GREATEST(billing_month + (due_day - 1), issue_date + due_day)
           END,
           'Mensualidad ' || ${MONTH_NAMES_SQL}[EXTRACT(MONTH FROM billing_month)::int] || ' ' || EXTRACT(YEAR FROM billing_month)::int,
           amount, currency
    FROM months
    ON CONFLICT (student_id, school_period_id, billing_month) WHERE kind = 'tuition'
    DO UPDATE SET
      status = 'pending', cancelled_at = NULL,
      guardian_id = EXCLUDED.guardian_id, enrollment_id = EXCLUDED.enrollment_id,
      issue_date = EXCLUDED.issue_date, due_date = EXCLUDED.due_date,
      amount = EXCLUDED.amount, currency = EXCLUDED.currency
    -- Solo se reactiva lo anulado bajo OTRA inscripción (retiro → reinscripción).
    -- Una anulación manual del administrador conserva la misma inscripción y se
    -- respeta: sin esta condición, cada consulta del estado de cuenta la deshacía.
    WHERE payments.status = 'cancelled'
      AND payments.enrollment_id IS DISTINCT FROM EXCLUDED.enrollment_id
    RETURNING (xmax = 0) AS inserted
    `,
    [...scopeBindings(tenantId, scope), tenantId]
  );

  const created = rows.filter((r) => r.inserted).length;
  const reactivated = rows.length - created;
  const skipped = await listSkippedEnrollments(trx, tenantId, scope);
  return { created, reactivated, skipped };
}

/** Inscripciones activas del alcance a las que no se les pudo generar mensualidades, con el motivo. */
async function listSkippedEnrollments(trx, tenantId, scope = {}) {
  const { rows } = await trx.raw(
    `
    SELECT e.id AS enrollment_id, s.id AS student_id, s.first_name, s.last_name,
           g.name AS grade_name, sec.name AS section_name, sp.name AS school_period_name,
           (sp.start_date IS NULL OR sp.end_date IS NULL) AS no_dates,
           NOT EXISTS (${FEE_LATERAL}) AS no_fee,
           NOT EXISTS (${GUARDIAN_LATERAL}) AS no_guardian
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN sections sec ON sec.id = e.section_id
    JOIN grades g ON g.id = sec.grade_id
    JOIN school_periods sp ON sp.id = sec.school_period_id
    WHERE ${scopeSql()} AND e.status = 'active'
    `,
    scopeBindings(tenantId, scope)
  );

  return rows
    .filter((r) => r.no_dates || r.no_fee || r.no_guardian)
    .map((r) => ({
      enrollment_id: r.enrollment_id,
      student_id: r.student_id,
      student_name: `${r.first_name} ${r.last_name}`,
      section: `${r.grade_name} ${r.section_name}`,
      school_period_name: r.school_period_name,
      reasons: [
        r.no_dates && 'El año escolar no tiene fechas de inicio y fin.',
        r.no_fee && 'No hay tarifa de mensualidad para su nivel en este año escolar.',
        r.no_guardian && 'El alumno no tiene representante asociado.',
      ].filter(Boolean),
    }));
}

/**
 * Al retirar a un alumno se anulan sus mensualidades PENDIENTES de meses
 * posteriores al actual. El mes en curso y los anteriores siguen adeudados.
 */
async function cancelFutureTuition(trx, tenantId, enrollmentId) {
  const cancelled = await trx('payments')
    .where({ tenant_id: tenantId, enrollment_id: enrollmentId, kind: 'tuition', status: 'pending' })
    .whereRaw("billing_month > date_trunc('month', current_date)")
    .update({ status: 'cancelled', cancelled_at: trx.fn.now() });
  return cancelled;
}

// ---------- Tarifas ----------

async function listFees(trx, tenantId, { schoolPeriodId } = {}) {
  const query = trx('tuition_fees as tf')
    .join('school_periods as sp', 'sp.id', 'tf.school_period_id')
    .leftJoin('education_levels as el', 'el.code', 'tf.level_code')
    .where('tf.tenant_id', tenantId)
    .select('tf.*', 'sp.name as school_period_name', 'el.name as level_name')
    .orderByRaw('sp.start_date DESC NULLS LAST, el.sort_order NULLS FIRST');
  if (schoolPeriodId) query.andWhere('tf.school_period_id', schoolPeriodId);
  return query;
}

/** Crea o actualiza la tarifa del año escolar (general si `levelCode` es null, o de un nivel). */
async function upsertFee(trx, tenantId, { schoolPeriodId, levelCode = null, amount, currency = 'USD', dueDay = 5 }) {
  const period = await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (levelCode && !(await trx('education_levels').where({ code: levelCode }).first())) {
    throw ApiError.badRequest('Nivel educativo inválido.');
  }

  const existing = await trx('tuition_fees')
    .where({ tenant_id: tenantId, school_period_id: schoolPeriodId })
    .andWhere((q) => (levelCode ? q.where('level_code', levelCode) : q.whereNull('level_code')))
    .first();

  const values = { amount, currency: currency.toUpperCase(), due_day: dueDay, updated_at: trx.fn.now() };
  if (existing) {
    await trx('tuition_fees').where({ id: existing.id }).update(values);
  } else {
    await trx('tuition_fees').insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, level_code: levelCode, ...values });
  }
  return listFees(trx, tenantId, { schoolPeriodId });
}

async function deleteFee(trx, tenantId, id) {
  const deleted = await trx('tuition_fees').where({ id, tenant_id: tenantId }).delete();
  if (!deleted) throw ApiError.notFound('Tarifa no encontrada.');
}

/**
 * Garantiza que el estado de cuenta esté completo ANTES de leerlo: genera los
 * meses que falten (idempotente) y devuelve las inscripciones que no se
 * pudieron facturar, para que la interfaz nunca muestre "al día" por error
 * cuando en realidad faltan datos (tarifa, representante o fechas del año).
 *
 * Se llama desde las consultas de estado de cuenta (portal, "Mis pagos",
 * listado y resumen administrativos). Cubre, por ejemplo, una tarifa cargada
 * después de inscribir sin que nadie pulse "Generar mensualidades".
 */
async function ensureTuition(trx, tenantId, scope = {}) {
  const { created, reactivated, skipped } = await generateTuition(trx, tenantId, scope);
  return { created, reactivated, billingIssues: skipped };
}

module.exports = { generateTuition, ensureTuition, listSkippedEnrollments, cancelFutureTuition, listFees, upsertFee, deleteFee };
