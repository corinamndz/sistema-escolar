const { ApiError } = require('../../utils/ApiError');

/**
 * Expediente académico de una inscripción (alumno en una sección de un año).
 *
 * Fuente: planes de evaluación de la sección (incluye planes compartidos entre
 * secciones, migración 012) → actividades → notas del alumno.
 *
 *   nota del lapso   = Σ (nota / máximo) × % de cada actividad calificada,
 *                      llevado a la escala del colegio (acumulado sobre 20)
 *   nota final       = promedio aritmético o ponderado de los lapsos del año
 *                      (normalmente 3); provisional si falta alguno
 *   aprobada         = nota final ≥ nota mínima del año escolar
 *   completa         = todos sus planes evaluados al 100% y con plan en todos
 *                      los lapsos del año
 * La normativa (nota mínima, reprobadas permitidas, promedio aritmético o
 * ponderado, redondeo) es de cada año escolar: migración 014.
 *
 * Al cerrar la inscripción (promoción) el resultado se congela en
 * `enrollment_subject_results`: el historial no cambia aunque luego se edite
 * un plan de un año cerrado.
 */

const GRADE_SCALE = 20;
const PASSING_GRADE = 10;
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

/** Normativa por defecto (la de la migración 014) si un año no tiene datos. */
const DEFAULT_RULES = { passing_grade: PASSING_GRADE, max_failed_subjects: 0, term_average_mode: 'arithmetic', grade_rounding: 'none' };

/** Redondeo "al entero" de la normativa: 9,5 → 10 · 9,49 → 9 (sobre el valor ya llevado a 2 decimales). */
const roundGrade = (n, mode) => (mode === 'integer' ? Math.floor(round2(n) + 0.5) : round2(n));

/**
 * Reglas de evaluación de varios años escolares, con sus lapsos ordenados.
 * Map periodId → { passing_grade, max_failed_subjects, term_average_mode,
 *                  effective_mode, grade_rounding, terms[], warning }
 * `effective_mode` es 'arithmetic' si se pidió ponderado pero los pesos de los
 * lapsos no suman 100 (se avisa en `warning` en vez de calcular mal).
 */
async function loadRules(trx, tenantId, periodIds) {
  const out = new Map();
  if (!periodIds.length) return out;
  const periods = await trx('school_periods').where('tenant_id', tenantId).whereIn('id', periodIds);
  const terms = await trx('terms')
    .where('tenant_id', tenantId)
    .whereIn('school_period_id', periodIds)
    .select('id', 'school_period_id', 'name', 'start_date', 'weight_percent', 'term_number')
    .orderByRaw('term_number NULLS LAST, start_date NULLS LAST, name');
  for (const p of periods) {
    const pTerms = terms
      .filter((t) => t.school_period_id === p.id)
      .map((t) => ({ id: t.id, name: t.name, term_number: t.term_number, start_date: t.start_date, weight_percent: t.weight_percent === null ? null : Number(t.weight_percent) }));
    const mode = p.term_average_mode || DEFAULT_RULES.term_average_mode;
    const weightSum = round2(pTerms.reduce((n, t) => n + (t.weight_percent || 0), 0));
    const weightsOk = pTerms.length > 0 && pTerms.every((t) => t.weight_percent) && weightSum === 100;
    out.set(p.id, {
      passing_grade: p.passing_grade === undefined || p.passing_grade === null ? DEFAULT_RULES.passing_grade : Number(p.passing_grade),
      max_failed_subjects: p.max_failed_subjects ?? DEFAULT_RULES.max_failed_subjects,
      term_average_mode: mode,
      effective_mode: mode === 'weighted' && weightsOk ? 'weighted' : 'arithmetic',
      grade_rounding: p.grade_rounding || DEFAULT_RULES.grade_rounding,
      terms: pTerms,
      warning:
        mode === 'weighted' && !weightsOk
          ? `Los pesos de los lapsos suman ${weightSum}% (deben sumar 100%): se usa el promedio aritmético.`
          : pTerms.length === 0
            ? 'El año escolar no tiene lapsos registrados.'
            : null,
    });
  }
  return out;
}

/**
 * Promedio anual de una materia a partir de sus definitivas de lapso.
 *   aritmético → Σ notas / nº de lapsos
 *   ponderado  → Σ (nota × peso) / Σ pesos
 * Solo es DEFINITIVO si hay nota en TODOS los lapsos del año; si falta alguno
 * se devuelve el promedio PROVISIONAL de los lapsos con nota (un lapso sin
 * evaluar no cuenta como 0) y se informa cuáles faltan.
 */
function annualAverage(termEntries, rules) {
  const graded = termEntries.filter((t) => t.grade !== null);
  if (!graded.length) return { final: null, provisional: false };
  let value;
  if (rules.effective_mode === 'weighted') {
    const w = (t) => rules.terms.find((x) => x.id === t.term_id)?.weight_percent || 0;
    const totalW = graded.reduce((n, t) => n + w(t), 0);
    value = totalW ? graded.reduce((n, t) => n + t.grade * w(t), 0) / totalW : graded.reduce((n, t) => n + t.grade, 0) / graded.length;
  } else {
    value = graded.reduce((n, t) => n + t.grade, 0) / graded.length;
  }
  return { final: roundGrade(value, rules.grade_rounding), provisional: graded.length < termEntries.length };
}

/**
 * Calcula EN VIVO las notas por materia de varias inscripciones (una consulta
 * para todas: el panel de promoción procesa grados completos), con la
 * normativa del año escolar de cada una.
 *
 *   1. Definitiva del lapso (por materia) = acumulado de su plan de evaluación
 *      (simple o detallado): Σ (nota / máximo) × % de cada actividad → escala 20.
 *      Si hay más de un plan de la misma materia en el lapso, se promedian.
 *   2. Nota final de la materia = promedio (aritmético o ponderado) de las
 *      definitivas de TODOS los lapsos del año (normalmente 3).
 *   3. Aprobada si la nota final ≥ nota mínima del año.
 *   4. Materias reprobadas → se comparan con las permitidas (promoción).
 *   5. Promedio de cada lapso = Σ definitivas de las materias ÷ nº de materias
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

  // Materias CURSADAS: el plan de estudios del grado de cada sección (aunque una
  // materia aún no tenga plan de evaluación) más las materias con plan.
  const gradeOfSection = new Map(
    (await trx('sections').whereIn('id', sectionIds).select('id', 'grade_id')).map((s) => [s.id, s.grade_id])
  );
  const curriculum = await trx('grade_subjects as gs')
    .join('subjects as sub', 'sub.id', 'gs.subject_id')
    .whereIn('gs.grade_id', [...new Set(gradeOfSection.values())])
    .select('gs.grade_id', 'sub.id', 'sub.name')
    .orderBy(['gs.sort_order', 'sub.name']);

  /** Definitiva de un plan (una materia en un lapso) para un alumno. */
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
    // Sin actividades o sin NINGUNA nota del alumno: el lapso queda sin nota
    // (no cuenta como 0: "sin evaluar" no es "reprobado").
    const raw = status === 'no_activities' || status === 'no_grades' ? null : (earned / 100) * GRADE_SCALE;
    return { raw, status };
  };

  const STATUS_RANK = { no_plan: 0, no_activities: 1, no_grades: 2, in_progress: 3, final: 4 };

  for (const enr of enrollments) {
    const rules = rulesByPeriod.get(enr.school_period_id) || { ...DEFAULT_RULES, effective_mode: 'arithmetic', terms: [], warning: null };
    const periodTerms = rules.terms;

    // Materia → lapso → planes (normalmente uno).
    const subjects = new Map();
    for (const c of curriculum.filter((x) => x.grade_id === gradeOfSection.get(enr.section_id))) {
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
        // Una fila por CADA lapso del año (también los que aún no tienen plan),
        // más los lapsos con plan que no pertenezcan al año (dato inconsistente).
        const termIds = [...periodTerms.map((t) => t.id), ...[...byTerm.keys()].filter((id) => !periodTerms.some((t) => t.id === id))];
        const terms = termIds.map((termId) => {
          const results = byTerm.get(termId) || [];
          const withGrade = results.filter((r) => r.raw !== null);
          const status = results.length ? results.reduce((worst, r) => (STATUS_RANK[r.status] < STATUS_RANK[worst] ? r.status : worst), 'final') : 'no_plan';
          return {
            term_id: termId,
            term_name: periodTerms.find((t) => t.id === termId)?.name || '',
            term_number: periodTerms.find((t) => t.id === termId)?.term_number ?? null,
            grade: withGrade.length ? roundGrade(withGrade.reduce((n, r) => n + r.raw, 0) / withGrade.length, rules.grade_rounding) : null,
            status,
          };
        });
        const { final, provisional } = annualAverage(terms, rules);
        return {
          ...s,
          terms,
          final_grade: final,
          // Con lapsos pendientes la nota es provisional, pero se evalúa igual
          // (la sugerencia de promoción lo indica para que se revise).
          passed: final === null ? null : final >= rules.passing_grade,
          provisional,
          missing_terms: terms.filter((t) => t.grade === null).map((t) => t.term_name),
          // Completa: nota en todos los lapsos del año y cada plan evaluado al 100%.
          complete: periodTerms.length > 0 && terms.every((t) => t.status === 'final'),
        };
      })
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'es'));

    const withGrade = list.filter((s) => s.final_grade !== null);
    // Promedio del lapso = Σ definitivas de las materias en el lapso ÷ total de
    // materias CURSADAS (N). Es el promedio aritmético por materia, no por
    // actividades sueltas. Una materia sin definitiva en el lapso suma 0 pero
    // cuenta en N (se informa con graded_subjects < total_subjects). Un lapso
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
      final_average: withGrade.length ? round2(withGrade.reduce((n, s) => n + s.final_grade, 0) / withGrade.length) : null,
      failed_subjects: list.filter((s) => s.passed === false).length,
      pending_subjects: list.filter((s) => s.provisional).length,
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
  terms: r.terms.map((t) => ({ id: t.id, name: t.name, term_number: t.term_number, weight_percent: t.weight_percent })),
  warning: r.warning,
});

/**
 * Sugerencia de promoción a partir del expediente del año.
 *   reprobadas ≤ permitidas → promover (o egresar si es el último grado)
 *   reprobadas > permitidas → repetir
 * Con lapsos sin nota la decisión se toma con el promedio provisional y se
 * advierte en el motivo.
 */
function suggestOutcome(rec, { hasNextGrade, maxFailed }) {
  const advance = hasNextGrade ? 'promote' : 'graduate';
  if (!rec.graded) return { suggestion: advance, reason: 'Sin calificaciones registradas: revisa antes de promover.' };
  const n = rec.failed_subjects;
  const pending = rec.pending_subjects
    ? ` Provisional: ${rec.pending_subjects} materia(s) sin nota en todos los lapsos.`
    : '';
  if (n > maxFailed) {
    return { suggestion: 'retain', reason: `Reprobó ${n} materia(s); se permiten ${maxFailed}.${pending}` };
  }
  return {
    suggestion: advance,
    reason: (n ? `Reprobó ${n} materia(s), dentro de lo permitido (${maxFailed}): queda(n) pendiente(s).` : 'Aprobó todas las materias.') + pending,
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
