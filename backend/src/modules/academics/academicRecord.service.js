const { ApiError } = require('../../utils/ApiError');
const { exclusionOf } = require('./sectionSubjects');
const adjustments = require('../grading/gradeAdjustments.service');
const { studentRanks } = require('../grading/gradeSummary.service');
const { DEFAULT_RULES, PASSING_GRADE, loadRules, roundGrade, annualAverage, yearAverage } = require('../grading/gradeAverages');

/**
 * Expediente académico de una inscripción (alumno en una sección de un año).
 *
 * Fuente: planes de evaluación de la sección (incluye planes compartidos entre
 * secciones, migración 012) → actividades → notas del alumno.
 *
 *   nota del período   = Σ (nota / máximo) × % de cada actividad calificada,
 *                      llevado a la escala del colegio (acumulado sobre 20)
 *   nota final       = promedio aritmético o ponderado de los períodos del año
 *                      (los que defina el colegio); si falta alguno, según la
 *                      normativa: provisional o pendiente (grading/gradeAverages)
 *   aprobada         = nota final ≥ nota mínima del año escolar
 *   completa         = todos sus planes evaluados al 100% y con plan en todos
 *                      los períodos del año
 * La normativa (nota mínima, reprobadas permitidas, promedio aritmético o
 * ponderado, redondeo) es de cada año escolar: migración 014.
 *
 * Al cerrar la inscripción (promoción) el resultado se congela en
 * `enrollment_subject_results`: el historial no cambia aunque luego se edite
 * un plan de un año cerrado.
 */

const GRADE_SCALE = 20;
const round2 = (n) => Math.round(n * 100) / 100;

/** Datos de la inscripción con su sección, grado, nivel y año escolar. */
async function loadEnrollment(trx, tenantId, enrollmentId) {
  const e = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.id': enrollmentId, 'e.tenant_id': tenantId })
    .select(
      'e.*',
      'sec.name as section_name',
      'sec.grade_id',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      'sp.id as school_period_id',
      'sp.name as school_period_name',
      'sp.start_date as period_start',
      'sp.closed_at as period_closed_at'
    )
    .first();
  if (!e) throw ApiError.notFound('Inscripción no encontrada.');
  return e;
}

/**
 * Calcula EN VIVO las notas por materia de varias inscripciones (una consulta
 * para todas: el panel de promoción procesa grados completos), con la
 * normativa del año escolar de cada una.
 *
 *   1. Definitiva del período (por materia) = acumulado de su plan de evaluación
 *      (simple o detallado): Σ (nota / máximo) × % de cada actividad → escala 20.
 *      Si hay más de un plan de la misma materia en el período, se promedian.
 *   2. Nota final de la materia = promedio (aritmético o ponderado) de las
 *      definitivas de TODOS los períodos del año (grading/gradeAverages).
 *   3. Aprobada si la nota final ≥ nota mínima del año.
 *   4. Materias reprobadas → se comparan con las permitidas (promoción).
 *   5. Promedio de cada período = Σ definitivas de las materias ÷ nº de materias
 *      cursadas (plan de estudios del grado + materias con plan).
 *
 * Devuelve Map enrollmentId → { subjects, final_average, failed_subjects,
 * pending_subjects, complete, graded, rules }.
 */
async function computeRecords(trx, tenantId, enrollments) {
  const out = new Map();
  if (enrollments.length === 0) return out;
  const sectionIds = [...new Set(enrollments.map((e) => e.section_id))];
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const periodIds = [...new Set(enrollments.map((e) => e.school_period_id))];
  const rulesByPeriod = await loadRules(trx, tenantId, periodIds);

  // Planes de cada sección (directos o compartidos) con sus actividades.
  const plans = await trx('evaluation_plan_sections as x')
    .join('evaluation_plans as ep', 'ep.id', 'x.plan_id')
    .whereIn('x.section_id', sectionIds)
    .select('x.section_id', 'ep.id', 'ep.term_id', 'ep.subject', 'ep.subject_id');
  const planIds = [...new Set(plans.map((p) => p.id))];
  const activities = planIds.length
    ? await trx('evaluation_activities').whereIn('evaluation_plan_id', planIds).select('id', 'evaluation_plan_id', 'weight_percent')
    : [];
  const scores = activities.length
    ? await trx('activity_scores')
        .whereIn('evaluation_activity_id', activities.map((a) => a.id))
        .whereIn('student_id', studentIds)
        .select('evaluation_activity_id', 'student_id', 'raw_score', 'max_score')
    : [];
  const scoreOf = new Map(scores.map((s) => [`${s.evaluation_activity_id}|${s.student_id}`, s]));

  // Materias CURSADAS: las de cada sección (plan de estudios de su grado menos
  // las excluidas de la sección, migración 037), aunque una materia aún no tenga
  // plan de evaluación, más las materias con plan.
  const curriculum = await trx('grade_subjects as gs')
    .join('sections as sec', 'sec.grade_id', 'gs.grade_id')
    .join('subjects as sub', 'sub.id', 'gs.subject_id')
    .whereIn('sec.id', sectionIds)
    .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), trx.ref('gs.subject_id')))
    .select('sec.id as section_id', 'sub.id', 'sub.name')
    .orderBy(['gs.sort_order', 'sub.name']);

  /** Definitiva de un plan (una materia en un período) para un alumno. */
  const planResult = (plan, studentId, rules) => {
    const acts = activities.filter((a) => a.evaluation_plan_id === plan.id);
    let earned = 0;
    let totalWeight = 0;
    let evaluatedWeight = 0;
    for (const a of acts) {
      const w = Number(a.weight_percent);
      totalWeight += w;
      const sc = scoreOf.get(`${a.id}|${studentId}`);
      if (sc) {
        evaluatedWeight += w;
        earned += (Number(sc.raw_score) / Number(sc.max_score)) * w;
      }
    }
    const status = acts.length === 0 ? 'no_activities' : evaluatedWeight === 0 ? 'no_grades' : round2(totalWeight) === 100 && round2(evaluatedWeight) === 100 ? 'final' : 'in_progress';
    // Sin actividades o sin NINGUNA nota del alumno: el período queda sin nota
    // (no cuenta como 0: "sin evaluar" no es "reprobado").
    const raw = status === 'no_activities' || status === 'no_grades' ? null : (earned / 100) * GRADE_SCALE;
    return { raw, status };
  };

  const STATUS_RANK = { no_plan: 0, no_activities: 1, no_grades: 2, in_progress: 3, final: 4 };
  // Ajustes directivos vigentes de la definitiva (migración 084): reemplazan la nota del período.
  const effective = await adjustments.loadEffective(trx, tenantId, { studentIds, periodIds });

  for (const enr of enrollments) {
    const rules = rulesByPeriod.get(enr.school_period_id) || { ...DEFAULT_RULES, effective_mode: 'arithmetic', terms: [], warning: null };
    const periodTerms = rules.terms;

    // Materia → período → planes (normalmente uno).
    const subjects = new Map();
    for (const c of curriculum.filter((x) => x.section_id === enr.section_id)) {
      subjects.set(c.id, { subject_key: c.id, subject_id: c.id, subject_name: c.name, byTerm: new Map() });
    }
    // Un plan con el área en texto libre (Inicial/Primaria) se une a la materia del plan de estudios de igual nombre.
    const keyByName = (name) => [...subjects.values()].find((s) => s.subject_name.trim().toLowerCase() === name.trim().toLowerCase())?.subject_key;
    for (const plan of plans.filter((p) => p.section_id === enr.section_id)) {
      const key = plan.subject_id || keyByName(plan.subject) || plan.subject.trim().toLowerCase();
      if (!subjects.has(key)) subjects.set(key, { subject_key: key, subject_id: plan.subject_id, subject_name: plan.subject, byTerm: new Map() });
      const byTerm = subjects.get(key).byTerm;
      if (!byTerm.has(plan.term_id)) byTerm.set(plan.term_id, []);
      byTerm.get(plan.term_id).push(planResult(plan, enr.student_id, rules));
    }

    const list = [...subjects.values()]
      .map(({ byTerm, ...s }) => {
        // Una fila por CADA período del año (también los que aún no tienen plan),
        // más los períodos con plan que no pertenezcan al año (dato inconsistente).
        const termIds = [...periodTerms.map((t) => t.id), ...[...byTerm.keys()].filter((id) => !periodTerms.some((t) => t.id === id))];
        const terms = termIds.map((termId) => {
          const results = byTerm.get(termId) || [];
          const withGrade = results.filter((r) => r.raw !== null);
          const status = results.length ? results.reduce((worst, r) => (STATUS_RANK[r.status] < STATUS_RANK[worst] ? r.status : worst), 'final') : 'no_plan';
          const computed = withGrade.length ? roundGrade(withGrade.reduce((n, r) => n + r.raw, 0) / withGrade.length, rules.grade_rounding) : null;
          const adj = adjustments.findFor(effective, enr.student_id, termId, { subjectId: s.subject_id, name: s.subject_name });
          return {
            term_id: termId,
            term_name: periodTerms.find((t) => t.id === termId)?.name || '',
            term_number: periodTerms.find((t) => t.id === termId)?.term_number ?? null,
            // Ajuste directivo: es la definitiva del período (cuenta para el promedio, las reprobadas y la promoción).
            grade: adj ? adj.grade : computed,
            status: adj ? 'final' : status,
            ...(adj ? { computed_grade: computed, adjustment: { grade: adj.grade, previous: adj.previous, reason: adj.reason, by: adj.by, role: adj.role, at: adj.at } } : {}),
          };
        });
        const { final, provisional, pending } = annualAverage(terms, rules);
        return {
          ...s,
          terms,
          final_grade: final,
          // Con períodos pendientes la nota es provisional, pero se evalúa igual
          // (la sugerencia de promoción lo indica para que se revise).
          passed: final === null ? null : final >= rules.passing_grade,
          provisional,
          // La normativa exige todos los períodos con nota y cerrados: aún sin nota final.
          pending_closure: pending,
          missing_terms: terms.filter((t) => t.grade === null).map((t) => t.term_name),
          // Completa: nota en todos los períodos del año y cada plan evaluado al 100%.
          complete: periodTerms.length > 0 && terms.every((t) => t.status === 'final'),
        };
      })
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'es'));

    const withGrade = list.filter((s) => s.final_grade !== null);
    // Promedio del período = Σ definitivas de las materias en el período ÷ total de
    // materias CURSADAS (N). Es el promedio aritmético por materia, no por
    // actividades sueltas. Una materia sin definitiva en el período suma 0 pero
    // cuenta en N (se informa con graded_subjects < total_subjects). Un período
    // sin ninguna nota todavía no tiene promedio (null).
    const termAverages = periodTerms.map((t) => {
      const grades = list.map((s) => s.terms.find((x) => x.term_id === t.id)?.grade ?? null);
      const graded = grades.filter((g) => g !== null);
      const sum = graded.reduce((n, g) => n + g, 0);
      return {
        term_id: t.id,
        term_name: t.name,
        term_number: t.term_number,
        average: graded.length && list.length ? round2(sum / list.length) : null,
        sum: round2(sum),
        graded_subjects: graded.length,
        total_subjects: list.length,
      };
    });
    out.set(enr.id, {
      subjects: list,
      final_average: yearAverage(list.map((s) => ({ final: s.final_grade, pending: s.pending_closure })), rules),
      failed_subjects: list.filter((s) => s.passed === false).length,
      pending_subjects: list.filter((s) => s.provisional).length,
      awaiting_closure: list.filter((s) => s.pending_closure).length,
      term_averages: termAverages,
      complete: list.length > 0 && list.every((s) => s.complete),
      graded: withGrade.length > 0,
      rules: publicRules(rules),
    });
  }
  return out;
}

/** Reglas tal como se informan al frontend y se guardan con la inscripción cerrada. */
const publicRules = (r) => ({
  passing_grade: r.passing_grade,
  max_failed_subjects: r.max_failed_subjects,
  term_average_mode: r.term_average_mode,
  effective_mode: r.effective_mode,
  grade_rounding: r.grade_rounding,
  incomplete_average_policy: r.incomplete_average_policy,
  terms: r.terms.map((t) => ({ id: t.id, name: t.name, term_number: t.term_number, weight_percent: t.weight_percent })),
  warning: r.warning,
});

/**
 * Sugerencia de promoción a partir del expediente del año.
 *   reprobadas ≤ permitidas → promover (o egresar si es el último grado)
 *   reprobadas > permitidas → repetir
 * Con períodos sin nota la decisión se toma con el promedio provisional y se
 * advierte en el motivo. Si la normativa exige todos los períodos cerrados, las
 * materias sin nota final no cuentan como reprobadas y también se advierte.
 */
function suggestOutcome(rec, { hasNextGrade, maxFailed }) {
  const advance = hasNextGrade ? 'promote' : 'graduate';
  if (!rec.graded && rec.awaiting_closure) {
    return { suggestion: advance, reason: `Sin nota final: la normativa exige todos los períodos con nota y cerrados (${rec.awaiting_closure} materia(s) pendiente(s)). Revisa antes de promover.` };
  }
  if (!rec.graded) return { suggestion: advance, reason: 'Sin calificaciones registradas: revisa antes de promover.' };
  const n = rec.failed_subjects;
  const pending = rec.awaiting_closure
    ? ` Pendiente: ${rec.awaiting_closure} materia(s) sin nota final; la normativa exige todos los períodos con nota y cerrados.`
    : rec.pending_subjects
      ? ` Provisional: ${rec.pending_subjects} materia(s) sin nota en todos los períodos.`
      : '';
  if (n > maxFailed) {
    return { suggestion: 'retain', reason: `Reprobó ${n} materia(s); se permiten ${maxFailed}.${pending}` };
  }
  return {
    suggestion: advance,
    reason: (n ? `Reprobó ${n} materia(s), dentro de lo permitido (${maxFailed}): queda(n) pendiente(s).` : rec.awaiting_closure ? 'Aprobó las materias con nota final.' : 'Aprobó todas las materias.') + pending,
  };
}

/** Boleta congelada de inscripciones cerradas. Map enrollmentId → subjects[]. */
async function frozenResults(trx, enrollmentIds) {
  if (!enrollmentIds.length) return new Map();
  const rows = await trx('enrollment_subject_results').whereIn('enrollment_id', enrollmentIds).orderBy('subject_name');
  const map = new Map();
  rows.forEach((r) => {
    const list = map.get(r.enrollment_id) || [];
    list.push({
      subject_key: r.subject_key,
      subject_id: r.subject_id,
      subject_name: r.subject_name,
      terms: r.terms,
      final_grade: r.final_grade === null ? null : Number(r.final_grade),
      passed: r.passed,
      complete: r.complete,
    });
    map.set(r.enrollment_id, list);
  });
  return map;
}

/** Congela la boleta de una inscripción (al promover / cerrar). Reemplaza la anterior si la hubiera. */
async function freezeResults(trx, tenantId, enrollmentId, record) {
  await trx('enrollment_subject_results').where({ enrollment_id: enrollmentId }).delete();
  for (const s of record.subjects) {
    await trx('enrollment_subject_results').insert({
      tenant_id: tenantId,
      enrollment_id: enrollmentId,
      subject_key: s.subject_key,
      subject_id: s.subject_id,
      subject_name: s.subject_name,
      terms: JSON.stringify(s.terms),
      final_grade: s.final_grade,
      passed: s.passed,
      complete: s.complete,
    });
  }
}

const OUTCOME_LABELS = {
  active: 'Cursando',
  withdrawn: 'Retirado',
  promoted: 'Promovido',
  retained: 'Repite',
  graduated: 'Egresado',
};

/**
 * Historial académico de un alumno: todas sus inscripciones (años anteriores
 * y el actual), con grado, sección, resultado y notas por materia (congeladas
 * si el año ya se cerró para él; en vivo si sigue cursando).
 */
async function getStudentHistory(trx, tenantId, studentId) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).select('id', 'first_name', 'last_name', 'status').first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');

  const enrollments = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId })
    .select(
      'e.id',
      'e.student_id',
      'e.section_id',
      'e.status',
      'e.enrolled_at',
      'e.closed_at',
      'e.final_average',
      'e.failed_subjects',
      'e.outcome_notes',
      'e.evaluation_rules',
      'sec.name as section_name',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      'sp.id as school_period_id',
      'sp.name as school_period_name',
      'sp.closed_at as period_closed_at'
    )
    .orderByRaw('sp.start_date DESC NULLS LAST, e.enrolled_at DESC');

  const open = enrollments.filter((e) => !e.closed_at);
  const live = await computeRecords(trx, tenantId, open);
  // Normativa vigente de cada año (para inscripciones cerradas antes de la migración 014).
  const currentRules = await loadRules(trx, tenantId, [...new Set(enrollments.map((e) => e.school_period_id))]);
  const frozen = await frozenResults(trx, enrollments.filter((e) => e.closed_at).map((e) => e.id));
  // Puesto en la sección de cada año (consultas en serie: comparten la conexión de la transacción).
  const ranksByPeriod = new Map();
  for (const periodId of new Set(enrollments.map((e) => e.school_period_id))) {
    ranksByPeriod.set(periodId, await studentRanks(trx, tenantId, studentId, periodId));
  }

  return {
    student,
    scale: GRADE_SCALE,
    passing_grade: PASSING_GRADE,
    years: enrollments.map((e) => {
      const rec = e.closed_at ? null : live.get(e.id);
      return {
        enrollment_id: e.id,
        school_period: { id: e.school_period_id, name: e.school_period_name, closed: Boolean(e.period_closed_at) },
        section_id: e.section_id,
        grade_name: e.grade_name,
        level_code: e.level_code,
        level_name: e.level_name,
        section_name: e.section_name,
        status: e.status,
        status_label: OUTCOME_LABELS[e.status] || e.status,
        enrolled_at: e.enrolled_at,
        closed_at: e.closed_at,
        frozen: Boolean(e.closed_at),
        final_average: e.closed_at ? (e.final_average === null ? null : Number(e.final_average)) : rec.final_average,
        failed_subjects: e.closed_at ? e.failed_subjects : rec.failed_subjects,
        outcome_notes: e.outcome_notes,
        // Un retiro no compite por el puesto (la matrícula vigente de ese año, sí).
        section_rank: e.status === 'withdrawn' ? null : ranksByPeriod.get(e.school_period_id)?.annual || null,
        rules: e.closed_at ? e.evaluation_rules || publicRules(currentRules.get(e.school_period_id) || { ...DEFAULT_RULES, effective_mode: 'arithmetic', terms: [], warning: null }) : rec.rules,
        subjects: e.closed_at ? frozen.get(e.id) || [] : rec.subjects,
      };
    }),
  };
}

module.exports = {
  GRADE_SCALE,
  PASSING_GRADE,
  DEFAULT_RULES,
  OUTCOME_LABELS,
  loadRules,
  publicRules,
  suggestOutcome,
  loadEnrollment,
  computeRecords,
  freezeResults,
  frozenResults,
  getStudentHistory,
};
