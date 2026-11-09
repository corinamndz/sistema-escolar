const { ApiError } = require('../../utils/ApiError');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');
const adjustments = require('./gradeAdjustments.service');
const { loadRules, roundGrade, annualAverage, yearAverage } = require('./gradeAverages');

/**
 * Resumen de calificaciones (Administración): todos los alumnos activos con lo
 * que llevan acumulado en cada período del año escolar, y su boleta por materia.
 *
 * Mismo cálculo que el portal del representante (portal/grades.service), hecho
 * en una sola consulta para todo el colegio. Por materia y período (= un plan):
 *   earned     Σ (nota / máximo) × % de cada actividad calificada → puntos de 100
 *   evaluated  Σ % de las actividades ya calificadas
 *   accumulated  earned / 100 × 20      → "lleva X de 20"
 *   average      earned / evaluated × 20 → rendimiento en lo evaluado
 *   final        = accumulated cuando el plan suma 100% y todo está calificado
 * Por período del alumno: la media de sus materias (acumulado y rendimiento).
 */

const SCALE = 20;
const PASSING = 10;
// Matrículas que compiten por el puesto en la sección (todas las del año, salvo los retirados).
const RANK_STATUSES = ['active', 'promoted', 'retained', 'graduated'];
const round2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 100) / 100);
const mean = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/**
 * Notas de los alumnos en un año: Map alumno → Map materia → { key, name, terms: { <período>: celda } },
 * con los ajustes directivos vigentes ya aplicados. Filtros: studentId o sectionIds.
 */
async function loadSubjects(trx, tenantId, periodId, rules, { statuses, studentId = null, sectionIds = null, studentIds }) {
  // Una fila por alumno y plan (materia × período) con lo calificado.
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
    WHERE e.tenant_id = ? AND e.status = ANY(?) AND (?::uuid IS NULL OR e.student_id = ?::uuid)
      AND (?::uuid[] IS NULL OR e.section_id = ANY(?::uuid[]))
    GROUP BY e.student_id, ep.id, ep.term_id, ep.subject_id, ep.subject, sub.name
    `,
    [periodId, tenantId, tenantId, statuses, studentId, studentId, sectionIds, sectionIds]
  );

  const byStudent = new Map();
  planRows.forEach((r) => {
    // Con la misma normativa de redondeo que el expediente y la promoción.
    const accumulated = roundGrade((r.earned / 100) * SCALE, rules.grade_rounding);
    const average = r.evaluated > 0 ? round2((r.earned / r.evaluated) * SCALE) : null;
    const complete = round2(r.total_weight) === 100 && round2(r.evaluated) === 100;
    const cell = { accumulated: r.graded ? accumulated : null, average, evaluated: round2(r.evaluated), final: complete ? accumulated : null, activities: r.activities, graded: r.graded };
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, new Map());
    const subjects = byStudent.get(r.student_id);
    if (!subjects.has(r.subject_key)) subjects.set(r.subject_key, { key: r.subject_key, name: r.subject_name, terms: {} });
    subjects.get(r.subject_key).terms[r.term_id] = cell;
  });

  // Ajustes directivos vigentes (migración 084): reemplazan la definitiva del período de esa materia.
  // La celda conserva lo calculado en `computed` y el ajuste en `adjustment` (indicador y motivo).
  const effective = await adjustments.loadEffective(trx, tenantId, { studentIds, periodIds: [periodId] });
  for (const [key, list] of effective) {
    const [sid, termId] = key.split('|');
    if (!byStudent.has(sid)) byStudent.set(sid, new Map());
    const subjects = byStudent.get(sid);
    for (const adj of list) {
      let subject = [...subjects.values()].find((x) => (adj.subject_id && x.key === adj.subject_id) || x.name.trim().toLowerCase() === adj.subject_name.trim().toLowerCase());
      if (!subject) {
        subject = { key: adj.subject_id || adj.subject_name.trim().toLowerCase(), name: adj.subject_name, terms: {} };
        subjects.set(subject.key, subject);
      }
      const cell = subject.terms[termId] || { accumulated: null, average: null, evaluated: 0, final: null, activities: 0, graded: 0 };
      subject.terms[termId] = {
        ...cell,
        computed: cell.final ?? cell.accumulated ?? null,
        accumulated: adj.grade,
        average: adj.grade,
        evaluated: 100,
        final: adj.grade,
        adjustment: adj,
      };
    }
  }
  return byStudent;
}

/**
 * Nota de una materia en un período (misma regla que la boleta oficial,
 * OfficialReportCard): la definitiva si el plan se evaluó completo; si no, lo
 * acumulado a la fecha, marcado como parcial.
 */
function termGrade(cell) {
  if (!cell || cell.accumulated === null) return null;
  return cell.final !== null && cell.final !== undefined ? { value: cell.final, partial: false } : { value: cell.accumulated, partial: true };
}

/**
 * Promedios de un alumno: los que se muestran en el resumen, el detalle y la
 * boleta, y sobre los que se calcula su puesto. El de un período es la media de
 * sus materias con nota; el anual, según la normativa del año (gradeAverages).
 */
function averagesOf(subjectList, terms, rules) {
  const subjects = subjectList.map((sub) => {
    const grades = terms.map((t) => termGrade(sub.terms[t.id]));
    const annual = annualAverage(terms.map((t, i) => ({ term_id: t.id, grade: grades[i]?.value ?? null })), rules);
    return {
      key: sub.key,
      name: sub.name,
      terms: Object.fromEntries(terms.map((t, i) => [t.id, grades[i] ? { ...sub.terms[t.id], value: grades[i].value, partial: grades[i].partial } : null])),
      definitive: annual.final,
      // Parcial si falta algún período o alguno no está evaluado completo.
      partial: grades.some((g) => !g || g.partial),
      // Pendiente: la normativa exige todos los períodos con nota y cerrados.
      pending: annual.pending,
      counted: annual.counted,
      divisor: annual.divisor,
    };
  });
  const termAverages = Object.fromEntries(
    terms.map((t) => {
      const vals = subjects.map((x) => x.terms[t.id]).filter(Boolean);
      return [t.id, vals.length ? { value: mean(vals.map((v) => v.value)), partial: vals.some((v) => v.partial) || vals.length < subjects.length } : null];
    })
  );
  return {
    subjects,
    termAverages,
    overall: yearAverage(subjects.map((x) => ({ final: x.definitive, pending: x.pending })), rules),
    overallPartial: subjects.some((x) => x.partial),
    overallPending: subjects.some((x) => x.pending),
  };
}

/**
 * Puestos de mayor a menor promedio. Empates: el mismo promedio (a 2 decimales,
 * como se muestra) comparte puesto y el siguiente salta: 18, 17, 17, 15 → 1, 2, 2, 4.
 * Sin promedio no ocupa puesto ni cuenta en el total.
 *   entries [{ id, value, partial }] → Map id → { position, total, tied }
 */
function rankPositions(entries) {
  const ranked = entries.filter((e) => e.value !== null && e.value !== undefined).sort((a, b) => b.value - a.value);
  const out = new Map();
  ranked.forEach((e, i) => {
    const first = ranked.findIndex((x) => x.value === e.value);
    out.set(e.id, { position: first + 1, total: ranked.length, tied: ranked.some((x) => x.id !== e.id && x.value === e.value) });
  });
  return out;
}

/**
 * Puesto en la sección de cada alumno, por período y anual → Map alumno →
 *   { terms: { <período>: { position, total, tied, provisional } | null }, annual: { … } | null }
 * Compiten todos los inscritos del año en la sección (también los ya promovidos
 * o egresados; no los retirados). provisional: el período sigue abierto, el año
 * tiene períodos abiertos, o alguien de la sección aún tiene notas parciales: el
 * puesto todavía puede cambiar.
 */
async function sectionRanks(trx, tenantId, periodId, terms, rules, sectionIds) {
  const out = new Map();
  if (!sectionIds.length) return out;
  const roster = await trx('enrollments')
    .where('tenant_id', tenantId)
    .whereIn('section_id', sectionIds)
    .whereIn('status', RANK_STATUSES)
    .select('student_id', 'section_id');
  const byStudent = await loadSubjects(trx, tenantId, periodId, rules, { statuses: RANK_STATUSES, sectionIds, studentIds: [...new Set(roster.map((r) => r.student_id))] });
  for (const sectionId of sectionIds) {
    const people = roster
      .filter((r) => r.section_id === sectionId)
      .map((r) => ({ id: r.student_id, ...averagesOf([...(byStudent.get(r.student_id)?.values() || [])], terms, rules) }));
    const withProvisional = (positions, provisional) => (id) => {
      const p = positions.get(id);
      return p ? { ...p, provisional } : null;
    };
    const byTerm = terms.map((t) => {
      const entries = people.map((p) => ({ id: p.id, value: p.termAverages[t.id]?.value ?? null, partial: p.termAverages[t.id]?.partial }));
      return [t.id, withProvisional(rankPositions(entries), !t.ended || entries.some((e) => e.value !== null && e.partial))];
    });
    const annual = withProvisional(
      rankPositions(people.map((p) => ({ id: p.id, value: p.overall }))),
      terms.some((t) => !t.ended) || people.some((p) => p.overall !== null && p.overallPartial)
    );
    for (const p of people) out.set(p.id, { terms: Object.fromEntries(byTerm.map(([id, get]) => [id, get(p.id)])), annual: annual(p.id) });
  }
  return out;
}

/**
 * `studentId`: solo ese alumno (con cualquier estatus) y su matrícula de ese año
 * aunque ya esté cerrada (promovido, repite, egresado). Sin él: todos los alumnos
 * activos con su matrícula activa.
 */
async function getSummary(trx, tenantId, { schoolPeriodId, studentId = null, levelCode = null } = {}) {
  const statuses = studentId ? ['active', 'promoted', 'retained', 'graduated'] : ['active'];
  const periods = await trx('school_periods')
    .where({ tenant_id: tenantId })
    .select('id', 'name', 'start_date', 'is_active', 'closed_at', 'passing_grade')
    .orderByRaw(currentPeriodOrder()); // el en curso primero: es el que se abre por defecto
  if (!periods.length) return { periods: [], school_period: null, terms: [], rules: null, students: [], scale: SCALE, passing_grade: PASSING };
  const period = schoolPeriodId ? periods.find((p) => p.id === schoolPeriodId) : periods[0];
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  const rules = (await loadRules(trx, tenantId, [period.id])).get(period.id);

  // ended: período cerrado (manualmente o por fecha); closed_at solo si lo cerró el Administrador.
  const terms = (
    await trx('terms as t')
      .leftJoin('users as u', 'u.id', 't.closed_by')
      .where({ 't.tenant_id': tenantId, 't.school_period_id': period.id })
      .select('t.id', 't.name', 't.term_number', 't.end_date', 't.closed_at', 'u.full_name as closed_by_name')
      .orderByRaw('t.term_number NULLS LAST, t.start_date NULLS LAST, t.name')
  ).map((t) => ({ ...t, ended: Boolean(period.closed_at) || adjustments.termEnded(t) })); // año finalizado: ya nada cambia

  // Alumnos activos y su sección (inscripción activa) en el año elegido.
  const students = await trx('students as s')
    .leftJoin(
      trx('enrollments as e')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .join('education_levels as el', 'el.code', 'g.level_code')
        .whereIn('e.status', statuses)
        .where('sec.school_period_id', period.id)
        .distinctOn('e.student_id')
        .select(
          'e.student_id',
          'e.status as enrollment_status',
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
    .where('s.tenant_id', tenantId)
    .modify((q) => (studentId ? q.where('s.id', studentId) : q.where('s.status', 'active')))
    // Coordinador: solo los alumnos de su nivel.
    .modify((q) => levelCode && q.where('cur.level_code', levelCode))
    .select('s.id', 's.first_name', 's.last_name', 's.national_id', 's.status as student_status', 'cur.*')
    .orderBy(['s.last_name', 's.first_name']);

  const byStudent = await loadSubjects(trx, tenantId, period.id, rules, { statuses, studentId, studentIds: students.map((x) => x.id) });
  // Puesto en la sección de cada alumno (por período y anual).
  const ranks = await sectionRanks(trx, tenantId, period.id, terms, rules, [...new Set(students.map((x) => x.section_id).filter(Boolean))]);

  const passing = period.passing_grade === null || period.passing_grade === undefined ? PASSING : Number(period.passing_grade);

  return {
    periods: periods.map(({ passing_grade: _p, ...p }) => p),
    school_period: { id: period.id, name: period.name, closed: Boolean(period.closed_at) },
    terms,
    rules,
    scale: SCALE,
    passing_grade: passing,
    students: students.map((s) => {
      const subjects = [...(byStudent.get(s.id)?.values() || [])].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      const averages = averagesOf(subjects, terms, rules);
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
        student_status: s.student_status,
        enrollment_status: s.enrollment_status || null,
        ranks: ranks.get(s.id) || null,
        section_id: s.section_id || null,
        section_name: s.section_name || null,
        grade_id: s.grade_id || null,
        grade_name: s.grade_name || null,
        level_code: s.level_code || null,
        level_sort: s.level_sort ?? null,
        grade_sort: s.grade_sort ?? null,
        grading_scale: s.grading_scale || 'quantitative',
        terms: termSummary,
        // Promedio del año: el mismo de la boleta, el detalle, el puesto y la promoción.
        overall: averages.overall,
        overall_partial: averages.overallPartial,
        overall_pending: averages.overallPending,
        // Promedios ya calculados para la boleta, que no debe recalcularlos.
        report: {
          subjects: Object.fromEntries(averages.subjects.map((x) => [x.key, { definitive: x.definitive, partial: x.partial, pending: x.pending, counted: x.counted, divisor: x.divisor }])),
          term_averages: averages.termAverages,
        },
        subjects,
      };
    }),
  };
}

/**
 * Desglose analítico de UN alumno en un año escolar (pantalla de detalle del
 * Resumen de calificaciones, sin descargar el PDF):
 *   student   nombre, cédula, grado, sección, escala
 *   subjects  [{ name, terms: { <período>: { value, partial, accumulated, average, evaluated, final } },
 *               definitive, partial, status }]
 *   termAverages / overall   promedio de cada período y definitivo del año
 *   student.ranks            puesto en la sección por período y anual (ver sectionRanks)
 * status de una materia (escala vigente: passing_grade del año):
 *   'approved' | 'failed'        definitiva con TODOS los períodos evaluados completos
 *   'on_track' | 'at_risk'       año en curso: lo que lleva aprueba / no aprueba
 *   'pending_closure'            la normativa exige todos los períodos con nota y cerrados
 *   'no_grades'                  sin notas aún
 */
async function getStudentDetail(trx, tenantId, studentId, { schoolPeriodId, levelCode = null } = {}) {
  const exists = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('id');
  if (!exists) throw ApiError.notFound('Alumno no encontrado.');
  const data = await getSummary(trx, tenantId, { schoolPeriodId, studentId, levelCode });
  if (levelCode && !data.students.length) throw ApiError.forbidden('Ese alumno no es de tu nivel.');
  const s = data.students[0];
  const passing = data.passing_grade;
  const statusOf = (value, partial, pending) => {
    if (pending) return 'pending_closure';
    if (value === null || value === undefined) return 'no_grades';
    if (partial) return value >= passing ? 'on_track' : 'at_risk';
    return value >= passing ? 'approved' : 'failed';
  };

  const averages = averagesOf(s?.subjects || [], data.terms, data.rules);
  const subjects = averages.subjects.map((sub) => ({ ...sub, status: statusOf(sub.definitive, sub.partial, sub.pending) }));
  const { termAverages, overall, overallPartial, overallPending } = averages;
  // Historial de ajustes directivos del año (transparencia: quién, cuándo, de cuánto a cuánto y por qué).
  const adjustmentHistory = data.school_period ? await adjustments.history(trx, tenantId, studentId, data.school_period.id) : [];
  return {
    adjustments: adjustmentHistory,
    school_period: data.school_period,
    periods: data.periods,
    terms: data.terms,
    rules: data.rules,
    scale: data.scale,
    passing_grade: passing,
    student: s
      ? {
          id: s.id,
          first_name: s.first_name,
          last_name: s.last_name,
          national_id: s.national_id,
          status: s.student_status, // active | graduated | withdrawn…
          section_id: s.section_id,
          section_name: s.section_name,
          grade_name: s.grade_name,
          level_code: s.level_code,
          grading_scale: s.grading_scale,
          enrollment_status: s.enrollment_status,
          ranks: s.ranks,
        }
      : null,
    subjects,
    termAverages,
    overall,
    overallPartial,
    overallPending,
    overallStatus: statusOf(overall, overallPartial, overallPending),
    counts: {
      approved: subjects.filter((x) => x.status === 'approved').length,
      failed: subjects.filter((x) => x.status === 'failed').length,
      at_risk: subjects.filter((x) => x.status === 'at_risk').length,
    },
  };
}

/** Puesto de un alumno en su sección en un año (por período y anual), o null si no estuvo inscrito. */
async function studentRanks(trx, tenantId, studentId, schoolPeriodId) {
  const { students } = await getSummary(trx, tenantId, { schoolPeriodId, studentId });
  return students[0]?.ranks || null;
}

module.exports = { getSummary, getStudentDetail, rankPositions, studentRanks };
