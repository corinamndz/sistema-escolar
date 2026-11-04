const { ApiError } = require('../../utils/ApiError');

/**
 * Mensualidades automáticas.
 *
 * Reglas:
 *  - Mensualidades regulares: cada mes del año escolar (septiembre a julio),
 *    desde el mes de inicio (o el de la inscripción, si el alumno entró más
 *    tarde) hasta el mes de fin. Agosto NUNCA es un mes regular.
 *  - Agosto (migración 072): se cobra junto con el mes regular que la
 *    administración indique por año escolar (school_periods.august_charge_month).
 *    Es una mensualidad propia («Mensualidad Agosto 2027 · se cobra con Julio
 *    2027») con la emisión y el vencimiento de ese mes. Sin configurar, no se
 *    genera (el panel de Tarifas lo advierte). Si se cambia el mes, el agosto
 *    pendiente y sin reportar se reprograma.
 *  - Mes normal: emisión el día 1, vencimiento el día `due_day` (5 por defecto).
 *  - Primer mes de una inscripción hecha a mitad de mes: se emite el día de la
 *    inscripción y vence `due_day` días después (para que no nazca vencida).
 *  - Monto: primero la TARIFA ESPECIAL del alumno (students.fee_plan_id, ver
 *    fee_plans: beca/descuento en % o monto fijo); si no tiene, la tarifa de su
 *    nivel en ese año escolar o, si no hay, la tarifa general del año. El monto
 *    se copia al pago (un cambio de tarifa del nivel no altera cobros ya
 *    generados; un cambio de tarifa especial sí recalcula los meses pendientes
 *    desde el mes en curso: applyStudentFeePlan).
 *  - Beca total (100 %): no se generan mensualidades.
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

/**
 * Monto a cobrar: la tarifa especial del alumno (alias `fp`, LEFT JOIN a
 * fee_plans) sobre la tarifa base del nivel (`base`). Sin tarifa especial, la base.
 * Puede dar 0 (beca total): esos meses no se cobran.
 */
const effectiveAmountSql = (base = 'f.amount', fp = 'fp') => `
  CASE ${fp}.kind
    WHEN 'fixed' THEN ${fp}.amount
    WHEN 'percentage' THEN round(${base} * (100 - ${fp}.percentage) / 100, 2)
    ELSE ${base}
  END`;

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
/**
 * Plan de mensualidades del alcance (CTE `dated`), común a la generación y a la
 * reprogramación de agosto. Una fila por alumno y mes a cobrar:
 *  - regulares: cada mes del año escolar (septiembre a julio) EXCEPTO agosto,
 *    desde el mes de inicio (o el de la inscripción) hasta el de fin;
 *  - agosto: si el año escolar tiene `august_charge_month`, una mensualidad con
 *    billing_month = agosto del año en que termina y la emisión / vencimiento del
 *    mes elegido (charge_month). Sin configurar, agosto no se genera.
 * Columnas: las de candidates + billing_month, charge_month, issue_date, due_date, period_label.
 */
function tuitionPlanSql() {
  return `
    candidates AS (
      SELECT e.id AS enrollment_id, e.student_id, e.enrolled_at, sp.id AS school_period_id,
             sp.start_date, sp.end_date, sp.august_charge_month, f.currency, f.due_day, gd.guardian_id,
             f.amount AS base_amount, fp.id AS fee_plan_id, ${effectiveAmountSql()} AS amount
      FROM enrollments e
      JOIN students st ON st.id = e.student_id
      LEFT JOIN fee_plans fp ON fp.id = st.fee_plan_id
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
      -- Regulares: los meses del año escolar, sin agosto.
      SELECT c.*, m::date AS billing_month, m::date AS charge_month
      FROM candidates c
      CROSS JOIN LATERAL generate_series(
        date_trunc('month', GREATEST(c.start_date, c.enrolled_at)),
        date_trunc('month', c.end_date),
        interval '1 month'
      ) AS m
      WHERE EXTRACT(MONTH FROM m) <> 8
      UNION ALL
      -- Agosto: junto con el mes regular que indicó la administración.
      SELECT c.*, make_date(EXTRACT(YEAR FROM c.end_date)::int, 8, 1), c.august_charge_month
      FROM candidates c
      WHERE c.august_charge_month IS NOT NULL
        AND c.enrolled_at < make_date(EXTRACT(YEAR FROM c.end_date)::int, 9, 1)
    ),
    issued AS (
      SELECT mo.*, GREATEST(mo.charge_month, mo.enrolled_at) AS issue_date FROM months mo
    ),
    dated AS (
      SELECT i.*,
             -- Mes normal: vence el día due_day. Emitido a mitad de mes (inscripción
             -- tardía): vence due_day días después, para que no nazca vencido.
             CASE WHEN i.issue_date = i.charge_month
                  THEN i.charge_month + (i.due_day - 1)
                  ELSE GREATEST(i.charge_month + (i.due_day - 1), i.issue_date + i.due_day)
             END AS due_date,
             'Mensualidad ' || ${MONTH_NAMES_SQL}[EXTRACT(MONTH FROM i.billing_month)::int] || ' ' || EXTRACT(YEAR FROM i.billing_month)::int
               || CASE WHEN i.charge_month <> i.billing_month
                       THEN ' · se cobra con ' || ${MONTH_NAMES_SQL}[EXTRACT(MONTH FROM i.charge_month)::int] || ' ' || EXTRACT(YEAR FROM i.charge_month)::int
                       ELSE '' END AS period_label
      FROM issued i
    )`;
}

/**
 * Genera (o completa) las mensualidades de las inscripciones activas en el
 * alcance indicado. Devuelve cuántas se crearon, cuántas se reactivaron,
 * cuántas de agosto se reprogramaron y qué inscripciones se omitieron y por qué.
 */
async function generateTuition(trx, tenantId, scope = {}) {
  const { rows } = await trx.raw(
    `
    WITH ${tuitionPlanSql()}
    INSERT INTO payments (
      tenant_id, student_id, guardian_id, kind, enrollment_id, school_period_id,
      billing_month, issue_date, due_date, period_label, amount, currency, base_amount, fee_plan_id
    )
    SELECT ?, student_id, guardian_id, 'tuition', enrollment_id, school_period_id,
           billing_month, issue_date, due_date, period_label,
           amount, currency, base_amount, fee_plan_id
    FROM dated
    WHERE amount > 0 -- beca total: nada que cobrar
    ON CONFLICT (student_id, school_period_id, billing_month) WHERE kind = 'tuition'
    DO UPDATE SET
      status = 'pending', cancelled_at = NULL, cancel_reason = NULL,
      base_amount = EXCLUDED.base_amount, fee_plan_id = EXCLUDED.fee_plan_id,
      guardian_id = EXCLUDED.guardian_id, enrollment_id = EXCLUDED.enrollment_id,
      issue_date = EXCLUDED.issue_date, due_date = EXCLUDED.due_date, period_label = EXCLUDED.period_label,
      amount = EXCLUDED.amount, currency = EXCLUDED.currency
    -- Solo se reactiva lo anulado bajo OTRA inscripción (retiro → reinscripción).
    -- Una anulación manual del administrador conserva la misma inscripción y se
    -- respeta: sin esta condición, cada consulta del estado de cuenta la deshacía.
    -- También vuelven los meses anulados por una beca total que se le quitó,
    -- solo los que aún no se emitían (los meses ya transcurridos con beca no se cobran).
    WHERE payments.status = 'cancelled'
      AND (payments.enrollment_id IS DISTINCT FROM EXCLUDED.enrollment_id
           OR (payments.cancel_reason = 'fee_plan' AND EXCLUDED.issue_date >= date_trunc('month', current_date)))
    RETURNING (xmax = 0) AS inserted
    `,
    [...scopeBindings(tenantId, scope), tenantId]
  );

  // Agosto ya generado y el colegio cambió el mes con que se cobra: se reprograma
  // (emisión, vencimiento y texto) si sigue pendiente, sin reportar y fuera de un pago agrupado.
  const { rowCount: augustRescheduled } = await trx.raw(
    `
    WITH ${tuitionPlanSql()}
    UPDATE payments p
    SET issue_date = d.issue_date, due_date = d.due_date, period_label = d.period_label
    FROM dated d
    WHERE p.kind = 'tuition'
      AND p.student_id = d.student_id AND p.school_period_id = d.school_period_id AND p.billing_month = d.billing_month
      AND EXTRACT(MONTH FROM d.billing_month) = 8
      AND p.status = 'pending' AND p.reported_at IS NULL AND p.batch_id IS NULL
      AND (p.issue_date, p.due_date, p.period_label) IS DISTINCT FROM (d.issue_date, d.due_date, d.period_label)
    `,
    scopeBindings(tenantId, scope)
  );

  const created = rows.filter((r) => r.inserted).length;
  const reactivated = rows.length - created;
  const skipped = await listSkippedEnrollments(trx, tenantId, scope);
  const august = scope.schoolPeriodId ? await augustStatus(trx, tenantId, scope.schoolPeriodId) : null;
  return { created, reactivated, skipped, augustRescheduled, august };
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

/**
 * Aplica la tarifa especial ACTUAL del alumno a sus mensualidades que aún se
 * pueden cambiar: pendientes, desde el mes en curso, que la familia no haya
 * reportado como pagadas ni incluido en un pago agrupado. Los meses pagados,
 * reportados o ya transcurridos conservan su monto (historial contable).
 *  - Monto nuevo > 0: se actualiza.
 *  - Beca total (0): el mes se anula con cancel_reason = 'fee_plan'.
 * Al final se generan los meses que falten y vuelven los anulados por una beca
 * total que ya no tiene (ver generateTuition).
 */
async function applyStudentFeePlan(trx, tenantId, studentId) {
  const { rows } = await trx.raw(
    `
    WITH calc AS (
      SELECT p.id, f.amount AS base_amount, fp.id AS fee_plan_id, ${effectiveAmountSql()} AS new_amount
      FROM payments p
      JOIN enrollments e ON e.id = p.enrollment_id
      JOIN sections sec ON sec.id = e.section_id
      JOIN grades g ON g.id = sec.grade_id
      JOIN school_periods sp ON sp.id = p.school_period_id
      JOIN students st ON st.id = p.student_id
      LEFT JOIN fee_plans fp ON fp.id = st.fee_plan_id
      JOIN LATERAL (${FEE_LATERAL}) f ON true
      WHERE p.tenant_id = ? AND p.student_id = ? AND p.kind = 'tuition' AND p.status = 'pending'
        AND p.reported_at IS NULL AND p.batch_id IS NULL
        AND COALESCE(p.issue_date, p.billing_month) >= date_trunc('month', current_date)
    )
    UPDATE payments p SET
      amount        = CASE WHEN c.new_amount > 0 THEN c.new_amount ELSE p.amount END,
      base_amount   = c.base_amount,
      fee_plan_id   = c.fee_plan_id,
      status        = CASE WHEN c.new_amount > 0 THEN p.status ELSE 'cancelled' END,
      cancelled_at  = CASE WHEN c.new_amount > 0 THEN p.cancelled_at ELSE now() END,
      cancel_reason = CASE WHEN c.new_amount > 0 THEN p.cancel_reason ELSE 'fee_plan' END
    FROM calc c
    WHERE p.id = c.id
      AND (c.new_amount <= 0 OR c.new_amount IS DISTINCT FROM p.amount OR c.fee_plan_id IS DISTINCT FROM p.fee_plan_id)
    RETURNING (c.new_amount > 0) AS kept
    `,
    [tenantId, studentId]
  );
  const { created, reactivated } = await generateTuition(trx, tenantId, { studentId });
  return {
    updated: rows.filter((r) => r.kept).length,
    cancelled: rows.filter((r) => !r.kept).length,
    created,
    reactivated,
  };
}

// ---------- Agosto ----------

const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const monthLabel = (iso) => `${MONTHS_ES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const isoMonth = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;

/** Meses regulares (sin agosto) de un año escolar, como 'YYYY-MM-01': las opciones para cobrar agosto. */
function regularMonths(period) {
  if (!period.start_date || !period.end_date) return [];
  const start = String(period.start_date).slice(0, 10);
  const end = String(period.end_date).slice(0, 10);
  const out = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (let guard = 0; guard < 24; guard += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (m !== 8) out.push(isoMonth(y, m));
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Configuración de agosto de un año escolar: { school_period_id, august_month,
 * charge_month (o null), options: [{ value, label }], generated }.
 */
async function augustStatus(trx, tenantId, schoolPeriodId) {
  const period = await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first('id', 'name', 'start_date', 'end_date', 'august_charge_month');
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  const augustMonth = period.end_date ? isoMonth(String(period.end_date).slice(0, 4), 8) : null;
  const generated = augustMonth
    ? Number((await trx('payments').where({ tenant_id: tenantId, school_period_id: period.id, kind: 'tuition', billing_month: augustMonth }).whereNot('status', 'cancelled').count('id as n').first()).n)
    : 0;
  const charge = period.august_charge_month ? String(period.august_charge_month).slice(0, 10) : null;
  return {
    school_period_id: period.id,
    school_period_name: period.name,
    august_month: augustMonth,
    august_label: augustMonth ? monthLabel(augustMonth) : null,
    charge_month: charge,
    charge_label: charge ? monthLabel(charge) : null,
    configured: Boolean(charge),
    options: regularMonths(period).map((value) => ({ value, label: monthLabel(value) })),
    generated,
  };
}

/**
 * Indica con qué mes regular se cobra agosto (`chargeMonth` 'YYYY-MM-01') y
 * aplica el cambio: genera agosto donde falte y reprograma el agosto pendiente.
 * `chargeMonth` null quita la configuración solo si aún no se generó ningún agosto.
 */
async function setAugustChargeMonth(trx, tenantId, schoolPeriodId, chargeMonth) {
  const status = await augustStatus(trx, tenantId, schoolPeriodId);
  if (chargeMonth === null) {
    if (status.generated > 0) {
      throw ApiError.conflict(`Ya hay ${status.generated} mensualidad(es) de agosto generadas: elige con qué mes se cobra en lugar de quitarlo.`);
    }
  } else if (!status.options.some((o) => o.value === chargeMonth)) {
    throw ApiError.badRequest('Elige uno de los meses regulares del año escolar (septiembre a julio).', [{ path: 'chargeMonth', message: 'Mes inválido.' }]);
  }
  await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).update({ august_charge_month: chargeMonth });
  const result = chargeMonth ? await generateTuition(trx, tenantId, { schoolPeriodId }) : null;
  return { ...(await augustStatus(trx, tenantId, schoolPeriodId)), created: result?.created ?? 0, rescheduled: result?.augustRescheduled ?? 0 };
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

module.exports = { augustStatus, setAugustChargeMonth, regularMonths, effectiveAmountSql, FEE_LATERAL, applyStudentFeePlan, generateTuition, ensureTuition, listSkippedEnrollments, cancelFutureTuition, listFees, upsertFee, deleteFee };
