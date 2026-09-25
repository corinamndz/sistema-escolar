const { ApiError } = require('../../utils/ApiError');

// ---------- Lapsos/periodos ----------

async function listTerms(trx, tenantId, { schoolPeriodId } = {}) {
  const query = trx('terms').where({ tenant_id: tenantId }).orderBy('start_date');
  if (schoolPeriodId) query.andWhere({ school_period_id: schoolPeriodId });
  return query;
}

async function createTerm(trx, tenantId, { schoolPeriodId, name, startDate, endDate }) {
  const [term] = await trx('terms')
    .insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, name, start_date: startDate, end_date: endDate })
    .returning('*');
  return term;
}

// ---------- Planes de evaluación ----------

async function listPlans(trx, tenantId, { sectionId, termId, teacherId } = {}) {
  const query = trx('evaluation_plans as ep')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('terms as t', 't.id', 'ep.term_id')
    .where('ep.tenant_id', tenantId)
    .select('ep.*', 'sec.name as section_name', 't.name as term_name')
    .orderBy('ep.created_at', 'desc');
  if (sectionId) query.andWhere('ep.section_id', sectionId);
  if (termId) query.andWhere('ep.term_id', termId);
  if (teacherId) query.andWhere('ep.teacher_id', teacherId);
  return query;
}

async function getPlanWithActivities(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .orderBy('created_at');

  const totalWeight = activities.reduce((sum, a) => sum + Number(a.weight_percent), 0);

  const project = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();

  let competencies = [];
  if (project) {
    competencies = await trx('project_competencies')
      .where({ tenant_id: tenantId, pedagogical_project_id: project.id });
  }

  return { ...plan, activities, totalWeight, pedagogicalProject: project ? { ...project, competencies } : null };
}

async function createPlan(trx, tenantId, { sectionId, termId, teacherId, subject }) {
  const existing = await trx('evaluation_plans')
    .where({ tenant_id: tenantId, section_id: sectionId, term_id: termId, teacher_id: teacherId, subject })
    .first();
  if (existing) {
    throw ApiError.conflict('Ya existe un plan de evaluación para esta sección, lapso, docente y asignatura.');
  }

  const [plan] = await trx('evaluation_plans')
    .insert({ tenant_id: tenantId, section_id: sectionId, term_id: termId, teacher_id: teacherId, subject })
    .returning('*');
  return plan;
}

// ---------- Proyectos pedagógicos y competencias ----------

async function createPedagogicalProject(trx, tenantId, planId, { title, description, competencies = [] }) {
  await getPlanWithActivities(trx, tenantId, planId); // valida que el plan exista

  const existing = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();
  if (existing) throw ApiError.conflict('Este plan ya tiene un proyecto pedagógico.');

  const [project] = await trx('pedagogical_projects')
    .insert({ tenant_id: tenantId, evaluation_plan_id: planId, title, description })
    .returning('*');

  if (competencies.length > 0) {
    await trx('project_competencies').insert(
      competencies.map((description) => ({
        tenant_id: tenantId,
        pedagogical_project_id: project.id,
        description,
      }))
    );
  }

  const createdCompetencies = await trx('project_competencies').where({ pedagogical_project_id: project.id });
  return { ...project, competencies: createdCompetencies };
}

async function addCompetency(trx, tenantId, projectId, { description }) {
  const project = await trx('pedagogical_projects').where({ id: projectId, tenant_id: tenantId }).first();
  if (!project) throw ApiError.notFound('Proyecto pedagógico no encontrado.');

  const [competency] = await trx('project_competencies')
    .insert({ tenant_id: tenantId, pedagogical_project_id: projectId, description })
    .returning('*');
  return competency;
}

// ---------- Actividades de evaluación (con la validación crítica del 100%) ----------

/**
 * Crea o actualiza una actividad de evaluación, validando que la sumatoria
 * de `weight_percent` de TODAS las actividades del plan (excluyendo la que
 * se está editando) más la nueva no supere 100.
 *
 * `forUpdate()` bloquea las filas de actividades del plan hasta que la
 * transacción de este request termine (commit/rollback lo hace
 * tenant.middleware al final del request), así que si dos docentes intentan
 * agregar actividades al mismo plan al mismo tiempo, la segunda espera a que
 * la primera transacción cierre antes de leer el total — evitando que ambas
 * lean "40% usado" y las dos agreguen 70% sin verse.
 *
 * Como red de seguridad adicional existe un CONSTRAINT TRIGGER en la base de
 * datos (migrations/001_init.sql) que rechaza el INSERT/UPDATE si, por
 * cualquier vía, la suma igual queda por encima de 100.
 */
async function upsertActivity(trx, tenantId, planId, { activityId, title, category, weightPercent }) {
  if (weightPercent <= 0 || weightPercent > 100) {
    throw ApiError.badRequest('El porcentaje debe estar entre 0 (exclusivo) y 100.');
  }

  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .forUpdate();

  if (activityId) {
    const exists = activities.find((a) => a.id === activityId);
    if (!exists) throw ApiError.notFound('Actividad no encontrada en este plan.');
  }

  const currentTotal = activities
    .filter((a) => a.id !== activityId)
    .reduce((sum, a) => sum + Number(a.weight_percent), 0);

  const newTotal = currentTotal + Number(weightPercent);

  if (newTotal > 100) {
    throw ApiError.unprocessable(
      `La suma de porcentajes excede 100%. Actual: ${currentTotal}%, intentando ${activityId ? 'actualizar a' : 'agregar'} ${weightPercent}% (total ${newTotal}%).`,
      { currentTotal, attempted: weightPercent, newTotal }
    );
  }

  if (activityId) {
    const [updated] = await trx('evaluation_activities')
      .where({ id: activityId, tenant_id: tenantId })
      .update({ title, category, weight_percent: weightPercent })
      .returning('*');
    return updated;
  }

  const [created] = await trx('evaluation_activities')
    .insert({ tenant_id: tenantId, evaluation_plan_id: planId, title, category, weight_percent: weightPercent })
    .returning('*');
  return created;
}

async function deleteActivity(trx, tenantId, activityId) {
  const activity = await trx('evaluation_activities').where({ id: activityId, tenant_id: tenantId }).first();
  if (!activity) throw ApiError.notFound('Actividad no encontrada.');

  const hasScores = await trx('activity_scores').where({ evaluation_activity_id: activityId }).first();
  if (hasScores) {
    throw ApiError.conflict('No se puede eliminar: ya hay calificaciones registradas para esta actividad.');
  }

  await trx('evaluation_activities').where({ id: activityId }).delete();
}

module.exports = {
  listTerms,
  createTerm,
  listPlans,
  getPlanWithActivities,
  createPlan,
  createPedagogicalProject,
  addCompetency,
  upsertActivity,
  deleteActivity,
};
