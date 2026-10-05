const { ApiError } = require('../../utils/ApiError');
const academicService = require('./academic.service');
const tuition = require('../payments/tuition.service');
const record = require('./academicRecord.service');

/**
 * Cierre de año escolar y promoción de alumnos.
 *
 * Por cada alumno CURSANDO en el año que termina:
 *   promote   → nueva inscripción en el grado siguiente, en el año nuevo
 *   retain    → nueva inscripción en el MISMO grado, en el año nuevo (repite)
 *   graduate  → sin nueva inscripción; el alumno queda "egresado" (último grado)
 * La inscripción anterior NO se borra: queda cerrada con su resultado
 * (promoted / retained / graduated), promedio, materias reprobadas y la boleta
 * congelada. Sus deudas del año siguen vigentes; solo se anulan mensualidades
 * de meses futuros (igual que al retirar). Las notas del año anterior viven en
 * sus planes de evaluación, que tampoco se tocan.
 */

const ACTIONS = ['promote', 'retain', 'graduate'];
const OUTCOME = { promote: 'promoted', retain: 'retained', graduate: 'graduated' };

/** Grados en orden académico (nivel → orden → nombre): el "siguiente" de cada uno. */
async function gradeSequence(trx, tenantId) {
  return trx('grades as g')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where('g.tenant_id', tenantId)
    .select('g.id', 'g.name', 'g.level_code', 'el.name as level_name')
    .orderBy(['el.sort_order', 'g.sort_order', 'g.name']);
}

const nextOf = (sequence, gradeId) => {
  const i = sequence.findIndex((g) => g.id === gradeId);
  return i >= 0 && i < sequence.length - 1 ? sequence[i + 1] : null;
};

async function loadPeriods(trx, tenantId, fromPeriodId, toPeriodId) {
  if (fromPeriodId === toPeriodId) {
    throw ApiError.badRequest('El año escolar nuevo debe ser distinto del que finaliza.', [{ path: 'toPeriodId', message: 'Elige otro año.' }]);
  }
  const from = await trx('school_periods').where({ id: fromPeriodId, tenant_id: tenantId }).first();
  const to = await trx('school_periods').where({ id: toPeriodId, tenant_id: tenantId }).first();
  if (!from) throw ApiError.notFound('Año escolar que finaliza no encontrado.');
  if (!to) throw ApiError.notFound('Año escolar nuevo no encontrado.');
  if (to.closed_at) throw ApiError.unprocessable(`El año escolar ${to.name} ya está finalizado: elige un año en curso o futuro.`);
  if (from.closed_at) throw ApiError.unprocessable(`El año escolar ${from.name} ya está finalizado.`);
  return { from, to };
}

/** Inscripciones del año (con datos de sección y grado), opcionalmente de un grado. */
function periodEnrollments(trx, tenantId, periodId, { gradeId, statuses } = {}) {
  return trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'e.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .whereIn('e.status', statuses)
    .modify((q) => gradeId && q.andWhere('sec.grade_id', gradeId))
    .select(
      'e.*',
      'sec.school_period_id',
      'sec.grade_id',
      'sec.name as section_name',
      'g.name as grade_name',
      's.first_name',
      's.last_name',
      's.national_id'
    )
    .orderBy(['g.sort_order', 'g.name', 'sec.name', 's.last_name', 's.first_name']);
}

/** Secciones del año nuevo por grado, con su cupo libre. */
async function targetSections(trx, tenantId, periodId) {
  const rows = await trx('sections as sec')
    .where({ 'sec.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .select(
      'sec.id',
      'sec.name',
      'sec.grade_id',
      'sec.max_students',
      trx.raw("(SELECT count(*)::int FROM enrollments e WHERE e.section_id = sec.id AND e.status = 'active') AS enrolled")
    )
    .orderBy('sec.name');
  const byGrade = {};
  rows.forEach((s) => (byGrade[s.grade_id] ||= []).push({ ...s, free: Math.max(0, s.max_students - s.enrolled) }));
  return byGrade;
}

/**
 * Vista previa: alumnos cursando el año que finaliza con sus notas, promedio,
 * materias reprobadas y una SUGERENCIA (promover / repetir / egresar) según la
 * normativa del año (nota mínima y materias reprobadas permitidas). `maxFailed`
 * permite simular otro límite sin guardarlo.
 * También devuelve los ya procesados (para poder deshacer).
 */
async function previewPromotion(trx, tenantId, { fromPeriodId, toPeriodId, gradeId, maxFailed: maxFailedOverride }) {
  const { from, to } = await loadPeriods(trx, tenantId, fromPeriodId, toPeriodId);
  const rules = (await record.loadRules(trx, tenantId, [from.id])).get(from.id);
  const maxFailed = maxFailedOverride ?? rules.max_failed_subjects;
  const sequence = await gradeSequence(trx, tenantId);
  const sections = await targetSections(trx, tenantId, to.id);

  const active = await periodEnrollments(trx, tenantId, from.id, { gradeId, statuses: ['active'] });
  const records = await record.computeRecords(trx, tenantId, active);

  const students = active.map((e) => {
    const rec = records.get(e.id);
    const next = nextOf(sequence, e.grade_id);
    const { suggestion, reason } = record.suggestOutcome(rec, { hasNextGrade: Boolean(next), maxFailed });
    // Sección sugerida: la del mismo nombre en el grado destino del año nuevo (A → A).
    const targetGradeId = suggestion === 'retain' ? e.grade_id : next?.id;
    const sameName = (sections[targetGradeId] || []).find((s) => s.name.toLowerCase() === e.section_name.toLowerCase());
    return {
      enrollment_id: e.id,
      student: { id: e.student_id, first_name: e.first_name, last_name: e.last_name, national_id: e.national_id },
      grade: { id: e.grade_id, name: e.grade_name },
      section_name: e.section_name,
      next_grade: next ? { id: next.id, name: next.name } : null,
      final_average: rec.final_average,
      failed_subjects: rec.failed_subjects,
      pending_subjects: rec.pending_subjects,
      // Promedio de cada lapso (I, II, III) y, en subjects[].terms, la nota de cada materia por lapso.
      term_averages: rec.term_averages,
      complete: rec.complete,
      graded: rec.graded,
      subjects: rec.subjects,
      suggestion,
      reason,
      suggested_section_id: sameName?.id || null,
    };
  });

  const processedRows = await periodEnrollments(trx, tenantId, from.id, { gradeId, statuses: ['promoted', 'retained', 'graduated'] });
  const nextIds = processedRows.map((p) => p.next_enrollment_id).filter(Boolean);
  const nextInfo = nextIds.length
    ? await trx('enrollments as e')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .whereIn('e.id', nextIds)
        .select('e.id', 'g.name as grade_name', 'sec.name as section_name')
    : [];
  const processed = processedRows.map((p) => ({
    enrollment_id: p.id,
    student: { id: p.student_id, first_name: p.first_name, last_name: p.last_name },
    grade: { id: p.grade_id, name: p.grade_name },
    section_name: p.section_name,
    status: p.status,
    status_label: record.OUTCOME_LABELS[p.status],
    final_average: p.final_average === null ? null : Number(p.final_average),
    failed_subjects: p.failed_subjects,
    next: nextInfo.find((n) => n.id === p.next_enrollment_id) || null,
  }));

  // Grados del año que finaliza (para el filtro) con su grado siguiente.
  const gradeIds = [...new Set([...active, ...processedRows].map((e) => e.grade_id))];
  const allFromGrades = await trx('sections').where({ tenant_id: tenantId, school_period_id: from.id }).distinct('grade_id').pluck('grade_id');
  const grades = sequence
    .filter((g) => allFromGrades.includes(g.id))
    .map((g) => ({ id: g.id, name: g.name, level_name: g.level_name, next:nextOf(sequence, g.id), pending: active.filter((e) => e.grade_id === g.id).length }));

  return {
    from_period: { id: from.id, name: from.name },
    to_period: { id: to.id, name: to.name },
    max_failed: maxFailed,
    passing_grade: rules.passing_grade,
    rules: record.publicRules(rules),
    grades,
    target_sections: sections,
    students,
    processed,
    pending_total: await trx('enrollments as e')
      .join('sections as sec', 'sec.id', 'e.section_id')
      .where({ 'e.tenant_id': tenantId, 'sec.school_period_id': from.id, 'e.status': 'active' })
      .count('e.id as n')
      .first()
      .then((r) => Number(r.n)),
    filtered_grade_ids: gradeIds,
  };
}

/** Sección destino: una existente del año nuevo y del grado correcto, o una nueva por nombre. */
async function resolveTargetSection(trx, tenantId, { to, targetGradeId, targetSectionId, createSectionName, canCreate }) {
  if (targetSectionId) {
    const section = await trx('sections').where({ id: targetSectionId, tenant_id: tenantId }).first();
    if (!section || section.school_period_id !== to.id || section.grade_id !== targetGradeId) {
      throw ApiError.badRequest('La sección destino no es del grado y año escolar correspondientes.');
    }
    return section;
  }
  if (!createSectionName) throw ApiError.badRequest('Elige la sección del año nuevo.');
  const existing = await trx('sections')
    .where({ tenant_id: tenantId, grade_id: targetGradeId, school_period_id: to.id })
    .whereRaw('lower(name) = lower(?)', [createSectionName.trim()])
    .first();
  if (existing) return existing;
  if (!canCreate) throw ApiError.forbidden('No tienes permiso para crear secciones: créalas en Estructura académica.');
  return academicService.createSection(trx, tenantId, { gradeId: targetGradeId, schoolPeriodId: to.id, name: createSectionName.trim(), maxStudents: 30 });
}

/** Procesa UNA decisión (dentro de su propio savepoint). */
async function applyDecision(trx, tenantId, userId, { from, to, sequence, canCreate }, d) {
  if (!ACTIONS.includes(d.action)) throw ApiError.badRequest('Acción inválida.');
  const enr = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('students as s', 's.id', 'e.student_id')
    .where({ 'e.id': d.enrollmentId, 'e.tenant_id': tenantId })
    .select('e.*', 'sec.school_period_id', 'sec.grade_id', 'g.name as grade_name', 's.first_name', 's.last_name')
    .forUpdate('e')
    .first();
  if (!enr) throw ApiError.notFound('Inscripción no encontrada.');
  if (enr.school_period_id !== from.id) throw ApiError.badRequest('La inscripción no es del año escolar que finaliza.');
  if (enr.status !== 'active') throw ApiError.conflict(`Ya fue procesado (${record.OUTCOME_LABELS[enr.status]}).`);

  const next = nextOf(sequence, enr.grade_id);
  if (d.action === 'graduate' && next) throw ApiError.unprocessable(`${enr.grade_name} no es el último grado: no puede egresar. Promuévelo a ${next.name}.`);
  if (d.action === 'promote' && !next) throw ApiError.unprocessable(`${enr.grade_name} es el último grado: el alumno egresa.`);

  // 1. Boleta congelada y resultado del año.
  const rec = (await record.computeRecords(trx, tenantId, [enr])).get(enr.id);
  await record.freezeResults(trx, tenantId, enr.id, rec);
  // Meses futuros del año que finaliza (si se cierra antes de tiempo); las deudas quedan.
  await tuition.cancelFutureTuition(trx, tenantId, enr.id);
  await trx('enrollments').where({ id: enr.id }).update({
    status: OUTCOME[d.action],
    closed_at: trx.fn.now(),
    closed_by: userId,
    final_average: rec.final_average,
    failed_subjects: rec.failed_subjects,
    outcome_notes: d.notes?.trim() || null,
    // Normativa con la que se decidió (el historial la conserva aunque luego cambie).
    evaluation_rules: JSON.stringify(rec.rules),
  });

  // 2. Inscripción del año nuevo (o egreso).
  if (d.action === 'graduate') {
    await trx('students').where({ id: enr.student_id }).update({ status: 'graduated' });
    return { message: `Egresado de ${enr.grade_name}` };
  }
  const targetGradeId = d.action === 'promote' ? next.id : enr.grade_id;
  const section = await resolveTargetSection(trx, tenantId, { to, targetGradeId, targetSectionId: d.targetSectionId, createSectionName: d.createSectionName, canCreate });
  const created = await academicService.enrollStudent(trx, tenantId, { studentId: enr.student_id, sectionId: section.id });
  await trx('enrollments').where({ id: enr.id }).update({ next_enrollment_id: created.id });
  const gradeName = d.action === 'promote' ? next.name : enr.grade_name;
  return { message: `${d.action === 'promote' ? 'Promovido' : 'Repite'}: ${gradeName} ${section.name} (${to.name})`, nextEnrollmentId: created.id };
}

/**
 * Ejecuta la promoción. Cada decisión va en su propio SAVEPOINT: si una falla
 * (sección sin cupo, ya procesado…), se revierte solo ella y las demás siguen.
 */
async function executePromotion(trx, tenantId, userId, actor, { fromPeriodId, toPeriodId, decisions }) {
  const { from, to } = await loadPeriods(trx, tenantId, fromPeriodId, toPeriodId);
  const ctx = { from, to, sequence: await gradeSequence(trx, tenantId), canCreate: Boolean(actor.permissions?.academics?.can_create) };
  const results = [];
  for (const d of decisions) {
    try {
      const out = await trx.transaction((sp) => applyDecision(sp, tenantId, userId, ctx, d));
      results.push({ enrollment_id: d.enrollmentId, action: d.action, ok: true, ...out });
    } catch (err) {
      results.push({ enrollment_id: d.enrollmentId, action: d.action, ok: false, message: err instanceof ApiError ? err.message : 'Error inesperado al procesar este alumno.' });
      if (!(err instanceof ApiError)) console.error('Error en promoción:', err); // eslint-disable-line no-console
    }
  }
  const done = results.filter((r) => r.ok).length;
  return {
    results,
    summary: { processed: done, failed: results.length - done },
    message: `Se procesaron ${done} alumno(s)${results.length - done ? ` y ${results.length - done} no se pudieron procesar` : ''}.`,
  };
}

/**
 * Deshace la promoción de un alumno mientras el año nuevo no tenga actividad
 * suya: sin notas ni pagos confirmados o reportados en la inscripción nueva.
 */
async function undoPromotion(trx, tenantId, enrollmentId) {
  const enr = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.id': enrollmentId, 'e.tenant_id': tenantId })
    .select('e.*', 'sp.closed_at as period_closed_at', 'sp.name as period_name')
    .forUpdate('e')
    .first();
  if (!enr) throw ApiError.notFound('Inscripción no encontrada.');
  if (!['promoted', 'retained', 'graduated'].includes(enr.status)) throw ApiError.conflict('Este alumno no fue procesado en la promoción.');
  if (enr.period_closed_at) throw ApiError.conflict(`El año ${enr.period_name} ya está finalizado: reábrelo para deshacer.`);

  if (enr.next_enrollment_id) {
    const next = await trx('enrollments').where({ id: enr.next_enrollment_id }).first();
    if (next) {
      const scored = await trx('activity_scores as sc')
        .join('evaluation_activities as a', 'a.id', 'sc.evaluation_activity_id')
        .join('evaluation_plan_sections as x', 'x.plan_id', 'a.evaluation_plan_id')
        .where({ 'sc.student_id': next.student_id, 'x.section_id': next.section_id })
        .first();
      if (scored) throw ApiError.conflict('El alumno ya tiene notas en el año nuevo: no se puede deshacer la promoción.');
      const paid = await trx('payments')
        .where({ enrollment_id: next.id })
        .andWhere((q) => q.whereIn('status', ['paid', 'refunded']).orWhereNotNull('reported_at'))
        .first();
      if (paid) throw ApiError.conflict('El alumno ya tiene pagos confirmados o reportados del año nuevo: no se puede deshacer.');
      // Mensualidades generadas al inscribir (todas pendientes, sin movimiento): se quitan.
      await trx('payments').where({ enrollment_id: next.id }).delete();
      await trx('enrollments').where({ id: next.id }).delete();
    }
  }
  if (enr.status === 'graduated') await trx('students').where({ id: enr.student_id }).update({ status: 'active' });
  // Mensualidades futuras anuladas al cerrar: vuelven a estar pendientes.
  await trx('payments')
    .where({ enrollment_id: enr.id, kind: 'tuition', status: 'cancelled' })
    .andWhere('cancelled_at', '>=', enr.closed_at)
    .update({ status: 'pending', cancelled_at: null });
  await trx('enrollment_subject_results').where({ enrollment_id: enr.id }).delete();
  await trx('enrollments').where({ id: enr.id }).update({
    status: 'active',
    closed_at: null,
    closed_by: null,
    final_average: null,
    failed_subjects: null,
    outcome_notes: null,
    evaluation_rules: null,
    next_enrollment_id: null,
  });
  return { ok: true };
}

/**
 * Finaliza el año escolar: solo cuando no queda ningún alumno cursando (todos
 * promovidos, repitientes, egresados o retirados). Queda inactivo y cerrado.
 */
async function closeSchoolPeriod(trx, tenantId, userId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).forUpdate().first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (period.closed_at) throw ApiError.conflict(`El año ${period.name} ya está finalizado.`);
  const { n } = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .where({ 'e.tenant_id': tenantId, 'sec.school_period_id': periodId, 'e.status': 'active' })
    .count('e.id as n')
    .first();
  if (Number(n) > 0) {
    throw ApiError.unprocessable(`Aún hay ${n} alumno(s) cursando ${period.name}: procésalos en la promoción (o retíralos) antes de finalizar el año.`);
  }
  const [closed] = await trx('school_periods')
    .where({ id: periodId })
    .update({ is_active: false, closed_at: trx.fn.now(), closed_by: userId })
    .returning('*');
  return closed;
}

/**
 * Normativa de evaluación de un año escolar: nota mínima, materias reprobadas
 * permitidas, promedio de lapsos (aritmético o ponderado con el peso de cada
 * lapso) y redondeo.
 */
async function getEvaluationRules(trx, tenantId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  const rules = (await record.loadRules(trx, tenantId, [period.id])).get(period.id);
  return { school_period: { id: period.id, name: period.name, closed: Boolean(period.closed_at) }, scale: record.GRADE_SCALE, ...rules };
}

/**
 * Guarda la normativa. En modo ponderado los pesos de TODOS los lapsos del año
 * deben sumar 100%. Un año finalizado no se puede modificar (sus boletas ya se
 * congelaron con la normativa vigente al cerrar).
 */
async function updateEvaluationRules(trx, tenantId, periodId, data) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado: reábrelo para cambiar su normativa.`);
  const terms = await trx('terms').where({ tenant_id: tenantId, school_period_id: periodId }).select('id', 'name');
  const weights = new Map((data.termWeights || []).map((w) => [w.termId, w.weightPercent]));
  if ([...weights.keys()].some((id) => !terms.some((t) => t.id === id))) {
    throw ApiError.badRequest('Hay lapsos que no pertenecen a este año escolar.', [{ path: 'termWeights', message: 'Lapso inválido.' }]);
  }

  if (data.termAverageMode === 'weighted') {
    if (!terms.length) throw ApiError.unprocessable('El año escolar no tiene lapsos: créalos antes de usar el promedio ponderado.');
    const missing = terms.filter((t) => !weights.get(t.id));
    if (missing.length) {
      throw ApiError.badRequest(`Indica el peso de: ${missing.map((t) => t.name).join(', ')}.`, [{ path: 'termWeights', message: 'Todos los lapsos necesitan peso.' }]);
    }
    const sum = Math.round(terms.reduce((n, t) => n + Number(weights.get(t.id)), 0) * 100) / 100;
    if (sum !== 100) throw ApiError.badRequest(`Los pesos de los lapsos suman ${sum}%: deben sumar 100%.`, [{ path: 'termWeights', message: 'Deben sumar 100%.' }]);
  }

  await trx('school_periods').where({ id: periodId }).update({
    passing_grade: data.passingGrade,
    max_failed_subjects: data.maxFailedSubjects,
    term_average_mode: data.termAverageMode,
    grade_rounding: data.gradeRounding,
  });
  for (const t of terms) {
    if (weights.has(t.id)) await trx('terms').where({ id: t.id }).update({ weight_percent: weights.get(t.id) || null });
  }
  return getEvaluationRules(trx, tenantId, periodId);
}

/** Reabre un año finalizado (corrección). No cambia los resultados de los alumnos. */
async function reopenSchoolPeriod(trx, tenantId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (!period.closed_at) throw ApiError.conflict('El año no está finalizado.');
  const [open] = await trx('school_periods').where({ id: periodId }).update({ closed_at: null, closed_by: null }).returning('*');
  return open;
}

module.exports = { getEvaluationRules, updateEvaluationRules, previewPromotion, executePromotion, undoPromotion, closeSchoolPeriod, reopenSchoolPeriod, gradeSequence };
