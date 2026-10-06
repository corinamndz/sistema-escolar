const { z } = require('zod');
const service = require('./evaluationPlan.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const teacherScope = require('../access/teacherScope');
const { ApiError } = require('../../utils/ApiError');
const academicService = require('../academics/academic.service');
const assignmentService = require('../academics/assignment.service');

// ---- Opciones para crear planes ----
// El docente no accede al módulo de Grados y secciones: estas consultas le
// dan SOLO lo de su carga docente del período activo (al resto, todo).

/** GET /evaluation-plans/options/school-periods — años escolares (docente: los de su carga). */
const listPeriodOptions = asyncHandler(async (req, res) => {
  const periods = await academicService.listSchoolPeriods(req.db, req.tenantId);
  const scope = await teacherScope.getTeacherScope(req);
  if (!scope) return res.status(200).json(periods);
  const mine = await req.db('sections').whereIn('id', scope.sectionIds).distinct().pluck('school_period_id');
  return res.status(200).json(periods.filter((p) => mine.includes(p.id)));
});

/** GET /evaluation-plans/options/sections — secciones (docente: solo las suyas). */
const listSectionOptions = asyncHandler(async (req, res) => {
  const rows = await academicService.listSections(req.db, req.tenantId, {});
  const scope = await teacherScope.getTeacherScope(req);
  res.status(200).json(scope ? rows.filter((s) => teacherScope.coversSection(scope, s.id)) : rows);
});

/**
 * GET /evaluation-plans/options/sections/:id/assignment — materias y docentes
 * de la sección para el formulario de plan. Docente: solo SUS materias y él
 * mismo como docente de aula (no ve la asignación de sus colegas).
 */
const getSectionAssignmentOptions = asyncHandler(async (req, res) => {
  await teacherScope.assertSectionAccess(req, req.params.id);
  const data = await assignmentService.getSectionAssignments(req.db, req.tenantId, req.params.id);
  const scope = await teacherScope.getTeacherScope(req);
  if (!scope) return res.status(200).json(data);
  const self = (t) => (t && t.id === scope.staffId ? t : null);
  return res.status(200).json({
    ...data,
    homeroom: data.homeroom ? { lead: self(data.homeroom.lead), assistant: self(data.homeroom.assistant) } : data.homeroom,
    subjects: (data.subjects || []).filter((s) => s.effectiveTeacher?.id === scope.staffId && teacherScope.coversSubject(scope, req.params.id, s.id)),
  });
});

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
    termNumber: z.coerce.number().int().min(1).max(3).optional(),
  });
  res.status(201).json(await service.createTerm(req.db, req.tenantId, schema.parse(req.body)));
});

// ---- Planes ----
const listPlans = asyncHandler(async (req, res) => {
  const { sectionId, termId, teacherId } = req.query;
  const termNumber = req.query.termNumber ? z.coerce.number().int().min(1).max(3).parse(req.query.termNumber) : undefined;
  const rows = await service.listPlans(req.db, req.tenantId, { sectionId, termId, termNumber, teacherId });
  // Docente: solo los planes de materias y secciones de su carga.
  const scope = await teacherScope.getTeacherScope(req);
  if (!scope || rows.length === 0) return res.status(200).json(rows);
  const links = await req.db('evaluation_plan_sections').whereIn('plan_id', rows.map((p) => p.id)).select('plan_id', 'section_id');
  const sectionsOf = (id) => links.filter((l) => l.plan_id === id).map((l) => l.section_id);
  return res.status(200).json(rows.filter((p) => teacherScope.coversPlan(scope, p, sectionsOf(p.id))));
});
const getPlan = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getPlanWithActivities(req.db, req.tenantId, req.params.id));
});
const createPlan = asyncHandler(async (req, res) => {
  const schema = z.object({
    // Una sección (sectionId) o varias del mismo grado (sectionIds): el plan se aplica a todas.
    sectionId: z.string().uuid().optional(),
    sectionIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    // Lapso académico: termNumber 1 | 2 | 3 (Lapso I, II, III) o, por compatibilidad, termId.
    termNumber: z.coerce.number({ invalid_type_error: 'Elige el lapso.' }).int().min(1, 'Elige el lapso.').max(3, 'Elige el lapso.').optional(),
    termId: z.string().uuid().optional(),
    format: z.enum(['simple', 'detailed']).default('simple'),
    // Secundaria: subjectId (el profesor se toma de la asignación). Inicial/Primaria: subject + teacherId.
    teacherId: z.string().uuid().optional(),
    subject: z.string().trim().min(1).optional(),
    subjectId: z.string().uuid().optional(),
  });
  const data = schema.parse(req.body);
  await assertCanCreatePlan(req, data);
  res.status(201).json(await service.createPlan(req.db, req.tenantId, data));
});

/**
 * Docente: solo puede crear planes de SU carga. Por materia (subjectId), la
 * materia debe ser suya en cada sección; de aula (texto libre), debe ser
 * docente de aula de cada sección y el plan queda a su nombre.
 */
async function assertCanCreatePlan(req, data) {
  const scope = await teacherScope.getTeacherScope(req);
  if (!scope) return;
  const sectionIds = data.sectionIds?.length ? data.sectionIds : [data.sectionId].filter(Boolean);
  const outside = sectionIds.find((id) => !teacherScope.coversSubject(scope, id, data.subjectId || null));
  if (outside) {
    throw ApiError.forbidden('Solo puedes crear planes de las materias y secciones de tu carga docente.', [{ path: 'sectionIds', message: 'Fuera de tu carga.' }]);
  }
  if (!data.subjectId && data.teacherId && data.teacherId !== scope.staffId) {
    throw ApiError.forbidden('Solo puedes crear planes a tu nombre.', [{ path: 'teacherId', message: 'Debe ser tu usuario.' }]);
  }
}

/** Cambia el formato o las secciones del plan. */
const updatePlan = asyncHandler(async (req, res) => {
  const data = z
    .object({
      format: z.enum(['simple', 'detailed']).optional(),
      sectionIds: z.array(z.string().uuid()).min(1).max(20).optional(),
      termNumber: z.coerce.number().int().min(1).max(3).optional(),
      termId: z.string().uuid().optional(),
    })
    .parse(req.body);
  const scope = await teacherScope.getTeacherScope(req);
  if (scope && data.sectionIds) {
    const plan = await req.db('evaluation_plans').where({ id: req.params.planId, tenant_id: req.tenantId }).select('subject_id').first();
    if (plan && data.sectionIds.some((id) => !teacherScope.coversSubject(scope, id, plan.subject_id))) {
      throw ApiError.forbidden('Solo puedes aplicar el plan a secciones de tu carga docente.', [{ path: 'sectionIds', message: 'Fuera de tu carga.' }]);
    }
  }
  res.status(200).json(await service.updatePlan(req.db, req.tenantId, req.params.planId, data));
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

// Número con como máximo 2 decimales (NUMERIC(5,2)); tolerancia por punto flotante.
const twoDecimals = z.number().refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Usa como máximo 2 decimales.');

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

  // ---- Formato detallado (todo opcional: si no se envía, se conserva lo guardado) ----
  strategy: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).nullable().optional()),
  // Referencias teórico-prácticas: temas con sus subtemas.
  contentRefs: z
    .array(
      z.object({
        topic: z.string().trim().min(1, 'Escribe el tema.').max(200),
        subtopics: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
      })
    )
    .max(30)
    .optional(),
  // Puntaje máximo de la actividad (los indicadores deben sumarlo).
  maxScore: twoDecimals.pipe(z.number().positive('Debe ser mayor que 0.').max(100)).optional(),
  criteria: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        title: z.string().trim().min(1, 'Escribe el criterio.').max(300),
        indicators: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              description: z.string().trim().min(1, 'Escribe el indicador.').max(300),
              points: twoDecimals.pipe(z.number().positive('El puntaje debe ser mayor que 0.').max(100)),
            })
          )
          .max(30),
      })
    )
    .max(20)
    .optional(),
  // Fecha de aplicación en cada sección del plan.
  sectionDates: z
    .array(z.object({ sectionId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.') }))
    .max(20)
    .optional(),
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
  listPeriodOptions,
  listSectionOptions,
  getSectionAssignmentOptions,
  updatePlan,
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
