const { ApiError } = require('../../utils/ApiError');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Registra o actualiza la nota de un alumno en una actividad y calcula
 * `weighted_score` = (raw_score / max_score) × porcentaje de la actividad (lo
 * que se acumula para la nota del lapso), igual en los dos formatos:
 *
 *  - Actividad simple: `rawScore` sobre `maxScore` (por defecto el de la actividad).
 *  - Actividad con indicadores (formato detallado): `indicatorScores` con la
 *    nota de CADA indicador (0 ≤ nota ≤ puntaje del indicador); raw_score es su
 *    suma y max_score el de la actividad (= suma de puntajes).
 *
 * El alumno debe estar inscrito en alguna de las secciones del plan.
 */
async function upsertScore(trx, tenantId, { activityId, studentId, rawScore, maxScore, indicatorScores }) {
  const activity = await trx('evaluation_activities').where({ id: activityId, tenant_id: tenantId }).first();
  if (!activity) throw ApiError.notFound('Actividad no encontrada.');

  const enrolled = await trx('enrollments as e')
    .join('evaluation_plan_sections as x', 'x.section_id', 'e.section_id')
    .where({ 'x.plan_id': activity.evaluation_plan_id, 'e.student_id': studentId, 'e.tenant_id': tenantId })
    .first();
  if (!enrolled) {
    throw ApiError.unprocessable('El alumno no está inscrito en ninguna sección de este plan de evaluación.');
  }

  const indicators = await trx('evaluation_indicators').where({ activity_id: activityId }).orderBy('position');
  let raw;
  let max;

  if (indicators.length) {
    if (!indicatorScores) {
      throw ApiError.badRequest('Esta actividad se califica por indicador: envía la nota de cada indicador.', [
        { path: 'indicatorScores', message: 'Requerido.' },
      ]);
    }
    const byId = new Map(indicators.map((i) => [i.id, i]));
    const given = new Map();
    for (const s of indicatorScores) {
      const ind = byId.get(s.indicatorId);
      if (!ind) throw ApiError.badRequest('Hay un indicador que no pertenece a esta actividad.');
      if (given.has(s.indicatorId)) throw ApiError.badRequest('Hay un indicador repetido.');
      if (s.points < 0 || s.points > Number(ind.points)) {
        throw ApiError.badRequest(`"${ind.description}": la nota debe estar entre 0 y ${Number(ind.points)}.`, [
          { path: `indicator.${ind.id}`, message: `Máximo ${Number(ind.points)}.` },
        ]);
      }
      given.set(s.indicatorId, s.points);
    }
    const missing = indicators.filter((i) => !given.has(i.id));
    if (missing.length) {
      throw ApiError.badRequest(`Falta la nota de ${missing.length === 1 ? 'un indicador' : `${missing.length} indicadores`}: ${missing.map((i) => i.description).join(', ')}.`, [
        { path: 'indicatorScores', message: 'Completa todos los indicadores.' },
      ]);
    }
    for (const ind of indicators) {
      await trx('indicator_scores')
        .insert({ tenant_id: tenantId, indicator_id: ind.id, activity_id: activityId, student_id: studentId, points: given.get(ind.id) })
        .onConflict(['indicator_id', 'student_id'])
        .merge({ points: given.get(ind.id), graded_at: trx.fn.now() });
    }
    raw = round2(indicators.reduce((n, i) => n + given.get(i.id), 0));
    max = Number(activity.max_score);
  } else {
    if (indicatorScores?.length) throw ApiError.badRequest('Esta actividad no tiene indicadores: envía una sola nota.');
    if (rawScore === undefined || rawScore === null) throw ApiError.badRequest('Indica la nota.', [{ path: 'rawScore', message: 'Requerida.' }]);
    max = maxScore ?? Number(activity.max_score);
    raw = rawScore;
    if (raw < 0 || raw > max) throw ApiError.badRequest(`La nota debe estar entre 0 y ${max}.`);
  }

  const weightedScore = (raw / max) * Number(activity.weight_percent);
  const payload = {
    tenant_id: tenantId,
    evaluation_activity_id: activityId,
    student_id: studentId,
    raw_score: raw,
    max_score: max,
    weighted_score: weightedScore,
    graded_at: trx.fn.now(),
  };

  const existing = await trx('activity_scores').where({ evaluation_activity_id: activityId, student_id: studentId }).first();
  if (existing) {
    const [updated] = await trx('activity_scores').where({ id: existing.id }).update(payload).returning('*');
    return updated;
  }
  const [created] = await trx('activity_scores').insert(payload).returning('*');
  return created;
}

/**
 * Libreta del plan: alumnos de TODAS sus secciones (o de `sectionId`), una
 * columna por actividad (con sus indicadores si es detallada) y el acumulado.
 */
async function getPlanGradebook(trx, tenantId, planId, { sectionId } = {}) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const sections = await trx('evaluation_plan_sections as x')
    .join('sections as s', 's.id', 'x.section_id')
    .where('x.plan_id', planId)
    .select('s.id', 's.name')
    .orderBy('s.name');
  if (sectionId && !sections.some((s) => s.id === sectionId)) {
    throw ApiError.badRequest('Esa sección no pertenece al plan.', [{ path: 'sectionId', message: 'Sección ajena.' }]);
  }

  const activityRows = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .orderBy('created_at');
  const indicators = activityRows.length
    ? await trx('evaluation_indicators as i')
        .join('evaluation_criteria as c', 'c.id', 'i.criterion_id')
        .whereIn('i.activity_id', activityRows.map((a) => a.id))
        .select('i.id', 'i.activity_id', 'i.description', 'i.points', 'c.position as criterion_position', 'i.position')
        .orderBy(['c.position', 'i.position'])
    : [];
  const activities = activityRows.map((a) => ({
    ...a,
    max_score: Number(a.max_score),
    indicators: indicators
      .filter((i) => i.activity_id === a.id)
      .map((i) => ({ id: i.id, code: `${i.criterion_position}.${i.position}`, description: i.description, points: Number(i.points) })),
  }));

  const students = await trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .join('evaluation_plan_sections as x', 'x.section_id', 'e.section_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .where({ 'e.tenant_id': tenantId, 'x.plan_id': planId, 'e.status': 'active' })
    .modify((q) => sectionId && q.andWhere('e.section_id', sectionId))
    .select('s.id', 's.first_name', 's.last_name', 'sec.id as section_id', 'sec.name as section_name')
    .orderBy(['sec.name', 's.last_name', 's.first_name']);

  const activityIds = activities.map((a) => a.id);
  const scores = activityIds.length ? await trx('activity_scores').whereIn('evaluation_activity_id', activityIds) : [];
  const indScores = activityIds.length ? await trx('indicator_scores').whereIn('activity_id', activityIds) : [];

  const rows = students.map((student) => {
    const studentScores = activities.map((activity) => {
      const score = scores.find((s) => s.evaluation_activity_id === activity.id && s.student_id === student.id);
      return {
        activityId: activity.id,
        activityTitle: activity.title,
        weightPercent: Number(activity.weight_percent),
        rawScore: score ? Number(score.raw_score) : null,
        maxScore: score ? Number(score.max_score) : activity.max_score,
        weightedScore: score ? Number(score.weighted_score) : 0,
        // Nota de cada indicador (formato detallado): { indicatorId: puntos }.
        indicatorScores: activity.indicators.length
          ? Object.fromEntries(
              indScores.filter((i) => i.activity_id === activity.id && i.student_id === student.id).map((i) => [i.indicator_id, Number(i.points)])
            )
          : null,
      };
    });
    const accumulated = studentScores.reduce((sum, s) => sum + (s.weightedScore || 0), 0);
    return { student, scores: studentScores, accumulated: Number(accumulated.toFixed(2)) };
  });

  return { plan, sections, activities, rows };
}

/** Registra si el alumno alcanzó o no cada competencia de un proyecto pedagógico. */
async function upsertCompetencyAssessment(trx, tenantId, { competencyId, studentId, result }) {
  if (!['achieved', 'needs_improvement'].includes(result)) {
    throw ApiError.badRequest('El resultado debe ser "achieved" o "needs_improvement".');
  }

  const competency = await trx('project_competencies').where({ id: competencyId, tenant_id: tenantId }).first();
  if (!competency) throw ApiError.notFound('Competencia no encontrada.');

  const existing = await trx('competency_assessments')
    .where({ project_competency_id: competencyId, student_id: studentId })
    .first();

  const payload = {
    tenant_id: tenantId,
    project_competency_id: competencyId,
    student_id: studentId,
    result,
    assessed_at: trx.fn.now(),
  };

  if (existing) {
    const [updated] = await trx('competency_assessments').where({ id: existing.id }).update(payload).returning('*');
    return updated;
  }
  const [created] = await trx('competency_assessments').insert(payload).returning('*');
  return created;
}

async function getCompetencyReport(trx, tenantId, projectId) {
  const project = await trx('pedagogical_projects').where({ id: projectId, tenant_id: tenantId }).first();
  if (!project) throw ApiError.notFound('Proyecto pedagógico no encontrado.');

  const competencies = await trx('project_competencies').where({ pedagogical_project_id: projectId });
  const assessments = await trx('competency_assessments')
    .whereIn('project_competency_id', competencies.map((c) => c.id));

  return competencies.map((c) => ({
    ...c,
    assessments: assessments.filter((a) => a.project_competency_id === c.id),
  }));
}

module.exports = { upsertScore, getPlanGradebook, upsertCompetencyAssessment, getCompetencyReport };
