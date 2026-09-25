const { z } = require('zod');
const service = require('./evaluationPlan.service');
const { asyncHandler } = require('../../utils/asyncHandler');

// ---- Lapsos ----
const listTerms = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listTerms(req.db, req.tenantId, { schoolPeriodId: req.query.schoolPeriodId }));
});
const createTerm = asyncHandler(async (req, res) => {
  const schema = z.object({
    schoolPeriodId: z.string().uuid(),
    name: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  });
  res.status(201).json(await service.createTerm(req.db, req.tenantId, schema.parse(req.body)));
});

// ---- Planes ----
const listPlans = asyncHandler(async (req, res) => {
  const { sectionId, termId, teacherId } = req.query;
  res.status(200).json(await service.listPlans(req.db, req.tenantId, { sectionId, termId, teacherId }));
});
const getPlan = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getPlanWithActivities(req.db, req.tenantId, req.params.id));
});
const createPlan = asyncHandler(async (req, res) => {
  const schema = z.object({
    sectionId: z.string().uuid(),
    termId: z.string().uuid(),
    teacherId: z.string().uuid(),
    subject: z.string().min(1),
  });
  res.status(201).json(await service.createPlan(req.db, req.tenantId, schema.parse(req.body)));
});

// ---- Proyecto pedagógico y competencias ----
const createProject = asyncHandler(async (req, res) => {
  const schema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    competencies: z.array(z.string().min(1)).default([]),
  });
  const data = schema.parse(req.body);
  res.status(201).json(await service.createPedagogicalProject(req.db, req.tenantId, req.params.planId, data));
});
const addCompetency = asyncHandler(async (req, res) => {
  const schema = z.object({ description: z.string().min(1) });
  res.status(201).json(await service.addCompetency(req.db, req.tenantId, req.params.projectId, schema.parse(req.body)));
});

// ---- Actividades (con validación del 100%) ----
const activitySchema = z.object({
  title: z.string().min(1),
  category: z.enum(['formative', 'exam', 'project', 'homework', 'other']),
  weightPercent: z.number().positive().max(100),
});

const createActivity = asyncHandler(async (req, res) => {
  const data = activitySchema.parse(req.body);
  const activity = await service.upsertActivity(req.db, req.tenantId, req.params.planId, data);
  res.status(201).json(activity);
});

const updateActivity = asyncHandler(async (req, res) => {
  const data = activitySchema.parse(req.body);
  const activity = await service.upsertActivity(req.db, req.tenantId, req.params.planId, {
    activityId: req.params.activityId,
    ...data,
  });
  res.status(200).json(activity);
});

const deleteActivity = asyncHandler(async (req, res) => {
  await service.deleteActivity(req.db, req.tenantId, req.params.activityId);
  res.status(204).send();
});

module.exports = {
  listTerms,
  createTerm,
  listPlans,
  getPlan,
  createPlan,
  createProject,
  addCompetency,
  createActivity,
  updateActivity,
  deleteActivity,
};
