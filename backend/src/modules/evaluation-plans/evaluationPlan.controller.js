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
    // Secundaria: subjectId (el profesor se toma de la asignación). Inicial/Primaria: subject + teacherId.
    teacherId: z.string().uuid().optional(),
    subject: z.string().trim().min(1).optional(),
    subjectId: z.string().uuid().optional(),
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
  title: z.string().trim().min(1, 'El título es obligatorio.').max(200),
  category: z.enum(['formative', 'exam', 'project', 'homework', 'other']),
  weightPercent: z
    .number()
    .positive('Debe ser mayor que 0.')
    .max(100, 'No puede superar 100%.')
    // La columna es NUMERIC(5,2): con más decimales se redondearía en silencio y
    // un plan "de 100%" podría quedar en 99,99% o 100,01%.
    // Con tolerancia: en punto flotante 33.33 * 100 = 3332.9999999999995, no 3333.
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Usa como máximo 2 decimales.'),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(1000).nullable().optional()),
  plannedDate: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').nullable().optional()
  ),
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
  await service.deleteActivity(req.db, req.tenantId, req.params.planId, req.params.activityId);
  res.status(204).send();
});

// ---- Cierre del plan (exige 100% exacto) ----
const closePlan = asyncHandler(async (req, res) => {
  res.status(200).json(await service.closePlan(req.db, req.tenantId, req.params.planId));
});
const reopenPlan = asyncHandler(async (req, res) => {
  res.status(200).json(await service.reopenPlan(req.db, req.tenantId, req.params.planId));
});

module.exports = {
  closePlan,
  reopenPlan,
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
