const { ApiError } = require('../../utils/ApiError');

/**
 * Registra o actualiza la nota de un alumno en una actividad, y calcula
 * automáticamente `weighted_score` = (raw_score / max_score) * weight_percent
 * de la actividad. Esto es lo que se acumula para la nota del lapso.
 */
async function upsertScore(trx, tenantId, { activityId, studentId, rawScore, maxScore = 20 }) {
  const activity = await trx('evaluation_activities').where({ id: activityId, tenant_id: tenantId }).first();
  if (!activity) throw ApiError.notFound('Actividad no encontrada.');

  if (rawScore < 0 || rawScore > maxScore) {
    throw ApiError.badRequest(`La nota debe estar entre 0 y ${maxScore}.`);
  }

  // Solo alumnos inscritos en la sección del plan (antes se podía calificar a
  // cualquier alumno del colegio, incluso de otra sección).
  const enrolled = await trx('enrollments as e')
    .join('evaluation_plans as ep', 'ep.section_id', 'e.section_id')
    .where({ 'ep.id': activity.evaluation_plan_id, 'e.student_id': studentId, 'e.tenant_id': tenantId })
    .first();
  if (!enrolled) {
    throw ApiError.unprocessable('El alumno no está inscrito en la sección de este plan de evaluación.');
  }

  const weightedScore = (rawScore / maxScore) * Number(activity.weight_percent);

  const existing = await trx('activity_scores')
    .where({ evaluation_activity_id: activityId, student_id: studentId })
    .first();

  const payload = {
    tenant_id: tenantId,
    evaluation_activity_id: activityId,
    student_id: studentId,
    raw_score: rawScore,
    max_score: maxScore,
    weighted_score: weightedScore,
    graded_at: trx.fn.now(),
  };

  if (existing) {
    const [updated] = await trx('activity_scores').where({ id: existing.id }).update(payload).returning('*');
    return updated;
  }
  const [created] = await trx('activity_scores').insert(payload).returning('*');
  return created;
}

/** Notas de todos los alumnos de una sección/plan, con el acumulado del lapso por alumno. */
async function getPlanGradebook(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .orderBy('created_at');

  const students = await trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .where('e.tenant_id', tenantId)
    .andWhere('e.section_id', plan.section_id)
    .andWhere('e.status', 'active')
    .select('s.id', 's.first_name', 's.last_name')
    .orderBy(['s.last_name', 's.first_name']);

  const scores = await trx('activity_scores')
    .whereIn('evaluation_activity_id', activities.map((a) => a.id));

  const rows = students.map((student) => {
    const studentScores = activities.map((activity) => {
      const score = scores.find((s) => s.evaluation_activity_id === activity.id && s.student_id === student.id);
      return {
        activityId: activity.id,
        activityTitle: activity.title,
        weightPercent: Number(activity.weight_percent),
        rawScore: score ? Number(score.raw_score) : null,
        maxScore: score ? Number(score.max_score) : null,
        weightedScore: score ? Number(score.weighted_score) : 0,
      };
    });
    const accumulated = studentScores.reduce((sum, s) => sum + (s.weightedScore || 0), 0);
    return { student, scores: studentScores, accumulated: Number(accumulated.toFixed(2)) };
  });

  return { plan, activities, rows };
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
