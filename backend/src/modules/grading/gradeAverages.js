const adjustments = require('./gradeAdjustments.service');

/**
 * Promedios del año según la normativa de cada año escolar. Es el único lugar
 * con estas reglas: lo usan el resumen, el detalle, la boleta y los puestos
 * (gradeSummary.service), el expediente y la promoción
 * (academics/academicRecord.service) y el portal (portal/grades.service).
 *
 * El divisor nunca es fijo: sale de los períodos definidos para ese año.
 */

const PASSING_GRADE = 10;
const DEFAULT_RULES = {
  passing_grade: PASSING_GRADE,
  max_failed_subjects: 0,
  term_average_mode: 'arithmetic',
  grade_rounding: 'none',
  incomplete_average_policy: 'evaluated_terms',
};

const round2 = (n) => Math.round(n * 100) / 100;

/** Redondeo "al entero" de la normativa: 9,5 → 10 · 9,49 → 9 (sobre el valor ya llevado a 2 decimales). */
const roundGrade = (n, mode) => (mode === 'integer' ? Math.floor(round2(n) + 0.5) : round2(n));

/**
 * Reglas de evaluación de varios años escolares, con sus períodos ordenados.
 * Map periodId → { passing_grade, max_failed_subjects, term_average_mode,
 *                  effective_mode, grade_rounding, incomplete_average_policy,
 *                  terms[], warning }
 * `effective_mode` es 'arithmetic' si se pidió ponderado pero los pesos de los
 * períodos no suman 100 (se avisa en `warning` en vez de calcular mal).
 * `terms[].ended`: cerrado a mano, por su fecha de fin o porque el año finalizó.
 */
async function loadRules(trx, tenantId, periodIds) {
  const out = new Map();
  if (!periodIds.length) return out;
  const periods = await trx('school_periods').where('tenant_id', tenantId).whereIn('id', periodIds);
  const terms = await trx('terms')
    .where('tenant_id', tenantId)
    .whereIn('school_period_id', periodIds)
    .select('id', 'school_period_id', 'name', 'start_date', 'end_date', 'closed_at', 'weight_percent', 'term_number')
    .orderByRaw('term_number NULLS LAST, start_date NULLS LAST, name');
  for (const p of periods) {
    const pTerms = terms
      .filter((t) => t.school_period_id === p.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        term_number: t.term_number,
        start_date: t.start_date,
        weight_percent: t.weight_percent === null ? null : Number(t.weight_percent),
        ended: Boolean(p.closed_at) || adjustments.termEnded(t),
      }));
    const mode = p.term_average_mode || DEFAULT_RULES.term_average_mode;
    const weightSum = round2(pTerms.reduce((n, t) => n + (t.weight_percent || 0), 0));
    const weightsOk = pTerms.length > 0 && pTerms.every((t) => t.weight_percent) && weightSum === 100;
    out.set(p.id, {
      passing_grade: p.passing_grade === undefined || p.passing_grade === null ? DEFAULT_RULES.passing_grade : Number(p.passing_grade),
      max_failed_subjects: p.max_failed_subjects ?? DEFAULT_RULES.max_failed_subjects,
      term_average_mode: mode,
      effective_mode: mode === 'weighted' && weightsOk ? 'weighted' : 'arithmetic',
      grade_rounding: p.grade_rounding || DEFAULT_RULES.grade_rounding,
      incomplete_average_policy: p.incomplete_average_policy || DEFAULT_RULES.incomplete_average_policy,
      terms: pTerms,
      warning:
        mode === 'weighted' && !weightsOk
          ? `Los pesos de los períodos suman ${weightSum}% (deben sumar 100%): se usa el promedio aritmético.`
          : pTerms.length === 0
            ? 'El año escolar no tiene períodos registrados.'
            : null,
    });
  }
  return out;
}

/**
 * Promedio anual de una materia a partir de sus notas de período.
 *   aritmético → Σ notas / nº de períodos definidos para el año
 *   ponderado  → Σ (nota × peso) / Σ pesos
 *
 * Si falta nota en algún período (un período sin evaluar nunca cuenta como 0):
 *   evaluated_terms   promedio PROVISIONAL de los períodos con nota
 *   all_terms_closed  sin promedio (`pending`) hasta que todos tengan nota y estén cerrados
 *
 *   entries [{ term_id, grade }] → { final, provisional, pending, counted, divisor }
 */
function annualAverage(entries, rules) {
  // Solo los períodos del año; una nota de otro año (dato inconsistente) no altera el divisor.
  const defined = rules.terms?.length ? entries.filter((e) => rules.terms.some((t) => t.id === e.term_id)) : entries;
  const graded = defined.filter((e) => e.grade !== null);
  const base = { counted: graded.length, divisor: rules.terms?.length || defined.length };
  if (!graded.length) return { final: null, provisional: false, pending: false, ...base };

  const missing = graded.length < base.divisor;
  if (rules.incomplete_average_policy === 'all_terms_closed' && (missing || rules.terms.some((t) => !t.ended))) {
    return { final: null, provisional: true, pending: true, ...base };
  }

  const simple = () => graded.reduce((n, e) => n + e.grade, 0) / graded.length;
  let value;
  if (rules.effective_mode === 'weighted') {
    const weight = (e) => rules.terms.find((t) => t.id === e.term_id)?.weight_percent || 0;
    const totalWeight = graded.reduce((n, e) => n + weight(e), 0);
    value = totalWeight ? graded.reduce((n, e) => n + e.grade * weight(e), 0) / totalWeight : simple();
  } else {
    value = simple();
  }
  return { final: roundGrade(value, rules.grade_rounding), provisional: missing, pending: false, ...base };
}

/**
 * Promedio general del alumno: la media de las notas anuales de sus materias. Si
 * la normativa exige todos los períodos y alguna materia está pendiente, no hay
 * promedio general: saldría de solo una parte de sus materias.
 *   subjects [{ final, pending }]
 */
function yearAverage(subjects, rules) {
  if (rules?.incomplete_average_policy === 'all_terms_closed' && subjects.some((s) => s.pending)) return null;
  const finals = subjects.map((s) => s.final).filter((v) => v !== null && v !== undefined);
  return finals.length ? round2(finals.reduce((n, v) => n + v, 0) / finals.length) : null;
}

module.exports = { DEFAULT_RULES, PASSING_GRADE, loadRules, roundGrade, annualAverage, yearAverage };
