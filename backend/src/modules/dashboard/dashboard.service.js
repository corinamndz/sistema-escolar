/**
 * Resumen gerencial del inicio (administración y directiva). Todo se cuenta en
 * SQL: el inicio no descarga listas completas. Cada bloque solo se arma si el
 * usuario puede leer ese módulo (`permissions`).
 */
const { restrictStaffToLevel } = require('../access/coordinatorScope');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');
const { DISPLAY_STATUS_SQL } = require('../payments/payment.service');

const LEVEL_ORDER = ['initial', 'primary', 'secondary'];

const n = (row, key = 'n') => Number(row?.[key] || 0);
const canRead = (permissions, module) => Boolean(permissions?.[module]?.can_read);

/** Alumnos activos y su nivel según la inscripción vigente en un año escolar activo. */
async function enrollmentByLevel(trx, tenantId) {
  const rows = await trx('students as s')
    .leftJoin(
      trx('enrollments as e')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .where({ 'e.status': 'active', 'sp.is_active': true })
        .distinctOn('e.student_id')
        .select('e.student_id', 'g.level_code')
        .orderBy('e.student_id')
        .as('cur'),
      'cur.student_id',
      's.id'
    )
    .where({ 's.tenant_id': tenantId, 's.status': 'active' })
    .groupBy('cur.level_code')
    .select('cur.level_code', trx.raw('count(*)::int AS n'));

  const levels = await trx('education_levels').select('code', 'name');
  const byLevel = LEVEL_ORDER.map((code) => ({
    code,
    name: levels.find((l) => l.code === code)?.name || code,
    value: n(rows.find((r) => r.level_code === code), 'n'),
  }));
  const unenrolled = n(rows.find((r) => r.level_code === null), 'n');
  return { total: rows.reduce((sum, r) => sum + r.n, 0), byLevel, unenrolled };
}

/**
 * Solvencia por representante (con al menos un alumno vinculado), con la
 * misma regla que el portal y el módulo de pagos:
 *   vencido      pendiente, sin reportar, emitido y con el vencimiento pasado
 *   pendiente    pendiente, sin reportar, emitido y aún sin vencer
 *   en revisión  pendiente que la familia reportó como pagado
 *   al día       nada de lo anterior
 * Cada representante cuenta una sola vez, en su estado más grave.
 */
async function guardianSolvency(trx, tenantId) {
  const { rows } = await trx.raw(
    `
    WITH g AS (
      SELECT sg.guardian_id,
        bool_or(p.status = 'pending' AND p.reported_at IS NULL AND (p.issue_date IS NULL OR p.issue_date <= current_date)
                AND p.due_date < current_date) AS overdue,
        bool_or(p.status = 'pending' AND p.reported_at IS NULL AND (p.issue_date IS NULL OR p.issue_date <= current_date)
                AND (p.due_date IS NULL OR p.due_date >= current_date)) AS pending,
        bool_or(p.status = 'pending' AND p.reported_at IS NOT NULL) AS in_review
      FROM student_guardians sg
      JOIN guardians gu ON gu.id = sg.guardian_id AND gu.tenant_id = ?
      LEFT JOIN payments p ON p.student_id = sg.student_id AND p.tenant_id = ? AND p.cancelled_at IS NULL
      GROUP BY sg.guardian_id
    )
    SELECT
      count(*) FILTER (WHERE overdue)::int AS overdue,
      count(*) FILTER (WHERE NOT overdue AND pending)::int AS pending,
      count(*) FILTER (WHERE NOT overdue AND NOT pending AND in_review)::int AS in_review,
      count(*) FILTER (WHERE NOT overdue AND NOT pending AND NOT in_review)::int AS up_to_date
    FROM (SELECT guardian_id, COALESCE(overdue, false) AS overdue, COALESCE(pending, false) AS pending, COALESCE(in_review, false) AS in_review FROM g) x
    `,
    [tenantId, tenantId]
  );
  const r = rows[0];
  return [
    { key: 'up_to_date', label: 'Al día', value: r.up_to_date },
    { key: 'pending', label: 'Pendientes', value: r.pending },
    { key: 'in_review', label: 'En revisión', value: r.in_review },
    { key: 'overdue', label: 'Vencidos', value: r.overdue },
  ];
}

/**
 * Inscripción del año escolar (el elegido en la barra superior o, sin elegir, el
 * año en curso). Inscrito = alumno activo con una planilla de inscripción
 * APROBADA de una convocatoria de ese año; con la planilla sin enviar, en
 * revisión o por corregir, NO cuenta como inscrito.
 *   approved    alumnos con planilla aprobada del año
 *   total       los cupos del año (suma de max_students de sus secciones) o, si
 *               ninguna sección tiene cupo, los alumnos activos  → total_basis
 *   active      alumnos activos del colegio
 *   in_review   con planilla enviada o por corregir (aún sin aprobar)
 *   without     alumnos activos sin planilla aprobada ni en revisión
 *   forms       convocatorias del año (0: el colegio aún no publica la planilla)
 */
async function enrollmentProgress(trx, tenantId, schoolPeriodId) {
  const q = trx('school_periods').where({ tenant_id: tenantId });
  const year = (schoolPeriodId ? await q.clone().where({ id: schoolPeriodId }).first('id', 'name') : null) || (await q.orderByRaw(currentPeriodOrder()).first('id', 'name'));
  if (!year) return null;
  const { rows: [r] } = await trx.raw(
    `WITH sub AS (
       SELECT x.student_id, x.status
       FROM enrollment_form_submissions x
       JOIN enrollment_forms f ON f.id = x.form_id AND f.school_period_id = :periodId
       JOIN students s ON s.id = x.student_id AND s.status = 'active'
       WHERE x.tenant_id = :tenantId
     )
     SELECT
       (SELECT count(DISTINCT student_id) FROM sub WHERE status = 'approved')::int AS approved,
       (SELECT count(DISTINCT student_id) FROM sub WHERE status IN ('submitted', 'changes_requested')
          AND student_id NOT IN (SELECT student_id FROM sub WHERE status = 'approved'))::int AS in_review,
       (SELECT count(*) FROM students s WHERE s.tenant_id = :tenantId AND s.status = 'active')::int AS active,
       (SELECT sum(max_students) FROM sections WHERE tenant_id = :tenantId AND school_period_id = :periodId)::int AS capacity,
       (SELECT count(*) FROM enrollment_forms WHERE tenant_id = :tenantId AND school_period_id = :periodId)::int AS forms`,
    { tenantId, periodId: year.id }
  );
  const byCapacity = r.capacity > 0;
  return {
    school_period: year,
    approved: r.approved,
    total: byCapacity ? r.capacity : r.active,
    total_basis: byCapacity ? 'capacity' : 'students',
    active: r.active,
    in_review: r.in_review,
    without: Math.max(0, r.active - r.approved - r.in_review),
    forms: r.forms,
  };
}

/**
 * Morosidad de las mensualidades del MES EN CURSO (billing_month), con la misma
 * regla de estados que el módulo de Pagos (DISPLAY_STATUS_SQL):
 *   billed     mensualidades del mes ya emitidas (pagadas, pendientes, vencidas o en revisión)
 *   overdue    vencidas sin pagar → morosidad = overdue / billed
 *   amounts    por moneda ([{ currency, total }], como Pagos): lo que falta cobrar del mes y lo vencido
 *   next_due   próximo vencimiento de las que aún no vencen (para explicar un 0 %)
 */
async function monthDelinquency(trx, tenantId) {
  const { rows } = await trx.raw(
    `WITH m AS (
       SELECT p.amount, p.currency, p.due_date, (${DISPLAY_STATUS_SQL}) AS st
       FROM payments p
       WHERE p.tenant_id = ? AND p.kind = 'tuition' AND p.cancelled_at IS NULL
         AND p.billing_month = date_trunc('month', current_date)::date
     )
     SELECT st, currency, count(*)::int AS n, sum(amount)::float AS amount, min(due_date) AS next_due
     FROM m WHERE st IN ('paid', 'pending', 'overdue', 'reported')
     GROUP BY st, currency`,
    [tenantId]
  );
  const count = (st) => rows.filter((r) => r.st === st).reduce((s, r) => s + r.n, 0);
  const amounts = (sts) => {
    const by = new Map();
    rows.filter((r) => sts.includes(r.st)).forEach((r) => by.set(r.currency, (by.get(r.currency) || 0) + r.amount));
    return [...by].map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }));
  };
  const billed = rows.reduce((s, r) => s + r.n, 0);
  const overdue = count('overdue');
  const nextDue = rows.filter((r) => r.st === 'pending').map((r) => r.next_due).sort()[0] || null;
  const month = await trx.raw("SELECT to_char(date_trunc('month', current_date), 'YYYY-MM') AS m");
  // Año escolar de esas mensualidades (el enlace a Pagos abre ese año, no el de la barra).
  const year = await trx('payments')
    .where({ tenant_id: tenantId, kind: 'tuition' })
    .whereNull('cancelled_at')
    .whereRaw("billing_month = date_trunc('month', current_date)::date")
    .whereNotNull('school_period_id')
    .groupBy('school_period_id')
    .orderByRaw('count(*) DESC')
    .first('school_period_id');
  return {
    month: month.rows[0].m,
    billed,
    paid: count('paid'),
    overdue,
    pending: count('pending'),
    reported: count('reported'),
    rate: billed ? Math.round((overdue / billed) * 1000) / 10 : null,
    due_amounts: amounts(['pending', 'overdue', 'reported']),
    overdue_amounts: amounts(['overdue']),
    next_due: nextDue,
    school_period_id: year?.school_period_id || null,
  };
}

async function getSummary(trx, tenantId, permissions, { levelCode = null, coordinator = false, schoolPeriodId = null } = {}) {
  const summary = { generated_at: new Date().toISOString() };

  if (canRead(permissions, 'students')) {
    summary.enrollment = await enrollmentByLevel(trx, tenantId);
    // Esperados vs. inscritos del año elegido (tarjeta ejecutiva).
    summary.enrollment_progress = await enrollmentProgress(trx, tenantId, schoolPeriodId);
  }
  if (canRead(permissions, 'guardians') || canRead(permissions, 'students')) {
    const linked = await trx('guardians as g')
      .where('g.tenant_id', tenantId)
      .select(
        trx.raw('count(*)::int AS total'),
        trx.raw('count(*) FILTER (WHERE EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.guardian_id = g.id))::int AS linked'),
        trx.raw('count(*) FILTER (WHERE g.user_id IS NOT NULL)::int AS with_access')
      )
      .first();
    summary.guardians = linked;
  }
  if (canRead(permissions, 'staff')) {
    const rows = await trx('staff as s')
      .where({ 's.tenant_id': tenantId, 's.status': 'active' })
      // Coordinador: solo los docentes de su nivel (sin nivel asignado: ninguno).
      .modify((q) => coordinator && (levelCode ? restrictStaffToLevel(q, trx, levelCode, 's') : q.whereRaw('false')))
      .groupBy('s.staff_type')
      .select('s.staff_type', trx.raw('count(*)::int AS n'));
    const of = (type) => n(rows.find((r) => r.staff_type === type));
    summary.staff = { total: rows.reduce((s, r) => s + r.n, 0), teaching: of('teaching'), coordinator: of('coordinator'), administrative: of('administrative'), support: of('support') };
  }
  if (canRead(permissions, 'academics')) {
    const subjects = await trx('subjects').where({ tenant_id: tenantId, is_active: true }).count('id as n').first();
    const sections = await trx('sections as sec')
      .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
      .where({ 'sec.tenant_id': tenantId, 'sp.is_active': true })
      .count('sec.id as n')
      .first();
    const period = await trx('school_periods').where({ tenant_id: tenantId, is_active: true }).orderBy('start_date', 'desc').first('name');
    summary.academics = { subjects: n(subjects), sections: n(sections), school_period: period?.name || null };
  }
  if (canRead(permissions, 'payments')) {
    summary.solvency = await guardianSolvency(trx, tenantId);
    // Morosidad de las mensualidades del mes en curso (tarjeta ejecutiva).
    summary.delinquency = await monthDelinquency(trx, tenantId);
  }
  return summary;
}

module.exports = { getSummary };
