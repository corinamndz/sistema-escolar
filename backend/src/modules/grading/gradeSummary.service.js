const { ApiError } = require('../../utils/ApiError');

/**
 * Resumen de calificaciones (Administración): todos los alumnos activos con lo
 * que llevan acumulado en cada lapso del año escolar, y su boleta por materia.
 *
 * Mismo cálculo que el portal del representante (portal/grades.service), hecho
 * en una sola consulta para todo el colegio. Por materia y lapso (= un plan):
 *   earned     Σ (nota / máximo) × % de cada actividad calificada → puntos de 100
 *   evaluated  Σ % de las actividades ya calificadas
 *   accumulated  earned / 100 × 20      → "lleva X de 20"
 *   average      earned / evaluated × 20 → rendimiento en lo evaluado
 *   final        = accumulated cuando el plan suma 100% y todo está calificado
 * Por lapso del alumno: la media de sus materias (acumulado y rendimiento).
 */

const SCALE = 20;
const PASSING = 10;
const round2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 100) / 100);
const mean = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

async function getSummary(trx, tenantId, { schoolPeriodId } = {}) {
  const periods = await trx('school_periods')
    .where({ tenant_id: tenantId })
    .select('id', 'name', 'start_date', 'is_active', 'closed_at', 'passing_grade')
    .orderByRaw('is_active DESC, start_date DESC NULLS LAST');
  if (!periods.length) return { periods: [], school_period: null, terms: [], students: [], scale: SCALE, passing_grade: PASSING };
  const period = schoolPeriodId ? periods.find((p) => p.id === schoolPeriodId) : periods[0];
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');

  const terms = await trx('terms')
    .where({ tenant_id: tenantId, school_period_id: period.id })
    .select('id', 'name', 'term_number')
    .orderByRaw('term_number NULLS LAST, start_date NULLS LAST, name');

  // Alumnos activos y su sección (inscripción activa) en el año elegido.
  const students = await trx('students as s')
    .leftJoin(
      trx('enrollments as e')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .join('education_levels as el', 'el.code', 'g.level_code')
        .where({ 'e.status': 'active', 'sec.school_period_id': period.id })
        .distinctOn('e.student_id')
        .select(
          'e.student_id',
          'sec.id as section_id',
          'sec.name as section_name',
          'g.id as grade_id',
          'g.name as grade_name',
          'g.level_code',
          'g.grading_scale',
          'el.sort_order as level_sort',
          'g.sort_order as grade_sort'
        )
        .orderBy('e.student_id')
        .as('cur'),
      'cur.student_id',
      's.id'
    )
    .where({ 's.tenant_id': tenantId, 's.status': 'active' })
    .select('s.id', 's.first_name', 's.last_name', 's.national_id', 'cur.*')
    .orderBy(['s.last_name', 's.first_name']);

  // Una fila por alumno y plan (materia × lapso) con lo calificado.
  const { rows: planRows } = await trx.raw(
    `
    SELECT e.student_id, ep.id AS plan_id, ep.term_id,
           COALESCE(ep.subject_id::text, lower(trim(ep.subject))) AS subject_key,
           COALESCE(sub.name, ep.subject) AS subject_name,
           sum(a.weight_percent)::float AS total_weight,
           COALESCE(sum(CASE WHEN sc.raw_score IS NOT NULL THEN a.weight_percent END), 0)::float AS evaluated,
           COALESCE(sum(CASE WHEN sc.raw_score IS NOT NULL THEN (sc.raw_score / NULLIF(sc.max_score, 0)) * a.weight_percent END), 0)::float AS earned,
           count(a.id)::int AS activities,
           count(sc.id)::int AS graded
    FROM enrollments e
    JOIN sections sec ON sec.id = e.section_id AND sec.school_period_id = ?
    JOIN evaluation_plan_sections eps ON eps.section_id = e.section_id
    JOIN evaluation_plans ep ON ep.id = eps.plan_id AND ep.tenant_id = ?
    LEFT JOIN subjects sub ON sub.id = ep.subject_id
    JOIN evaluation_activities a ON a.evaluation_plan_id = ep.id
    LEFT JOIN activity_scores sc ON sc.evaluation_activity_id = a.id AND sc.student_id = e.student_id
    WHERE e.tenant_id = ? AND e.status = 'active'
    GROUP BY e.student_id, ep.id, ep.term_id, ep.subject_id, ep.subject, sub.name
    `,
    [period.id, tenantId, tenantId]
  );

  const byStudent = new Map();
  planRows.forEach((r) => {
    const accumulated = round2((r.earned / 100) * SCALE);
    const average = r.evaluated > 0 ? round2((r.earned / r.evaluated) * SCALE) : null;
    const complete = round2(r.total_weight) === 100 && round2(r.evaluated) === 100;
    const cell = { accumulated: r.graded ? accumulated : null, average, evaluated: round2(r.evaluated), final: complete ? accumulated : null, activities: r.activities, graded: r.graded };
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, new Map());
    const subjects = byStudent.get(r.student_id);
    if (!subjects.has(r.subject_key)) subjects.set(r.subject_key, { key: r.subject_key, name: r.subject_name, terms: {} });
    subjects.get(r.subject_key).terms[r.term_id] = cell;
  });

  const passing = period.passing_grade === null || period.passing_grade === undefined ? PASSING : Number(period.passing_grade);

  return {
    periods: periods.map(({ passing_grade: _p, ...p }) => p),
    school_period: { id: period.id, name: period.name, closed: Boolean(period.closed_at) },
    terms,
    scale: SCALE,
    passing_grade: passing,
    students: students.map((s) => {
      const subjects = [...(byStudent.get(s.id)?.values() || [])].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const termSummary = Object.fromEntries(
        terms.map((t) => {
          const cells = subjects.map((sub) => sub.terms[t.id]).filter(Boolean);
          return [
            t.id,
            cells.length
              ? {
                  accumulated: mean(cells.map((c) => c.accumulated)),
                  average: mean(cells.map((c) => c.average)),
                  evaluated: mean(cells.map((c) => c.evaluated)),
                  subjects: cells.length,
                  graded: cells.filter((c) => c.graded > 0).length,
                  final: cells.every((c) => c.final !== null) ? mean(cells.map((c) => c.final)) : null,
                }
              : null,
          ];
        })
      );
      return {
        id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        national_id: s.national_id,
        section_id: s.section_id || null,
        section_name: s.section_name || null,
        grade_id: s.grade_id || null,
        grade_name: s.grade_name || null,
        level_code: s.level_code || null,
        level_sort: s.level_sort ?? null,
        grade_sort: s.grade_sort ?? null,
        grading_scale: s.grading_scale || 'quantitative',
        terms: termSummary,
        // Promedio de lo evaluado en el año: media de los lapsos con notas.
        overall: mean(Object.values(termSummary).map((x) => x?.average ?? null)),
        subjects,
      };
    }),
  };
}

module.exports = { getSummary };
