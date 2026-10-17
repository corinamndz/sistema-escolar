/**
 * Resumen gerencial del inicio (administración y directiva). Todo se cuenta en
 * SQL: el inicio no descarga listas completas. Cada bloque solo se arma si el
 * usuario puede leer ese módulo (`permissions`).
 */

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

async function getSummary(trx, tenantId, permissions) {
  const summary = { generated_at: new Date().toISOString() };

  if (canRead(permissions, 'students')) {
    summary.enrollment = await enrollmentByLevel(trx, tenantId);
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
    const rows = await trx('staff')
      .where({ tenant_id: tenantId, status: 'active' })
      .groupBy('staff_type')
      .select('staff_type', trx.raw('count(*)::int AS n'));
    const of = (type) => n(rows.find((r) => r.staff_type === type));
    summary.staff = { total: rows.reduce((s, r) => s + r.n, 0), teaching: of('teaching'), administrative: of('administrative'), support: of('support') };
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
  }
  return summary;
}

module.exports = { getSummary };
