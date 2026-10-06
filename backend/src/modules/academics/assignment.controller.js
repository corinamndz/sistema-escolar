const { z } = require('zod');
const service = require('./assignment.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuidOrNull = z.string().uuid().nullable();

// ---- Niveles ----
const listLevels = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listLevels(req.db));
});

// ---- Materias ----
const subjectSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100),
  code: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
});

const listSubjects = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listSubjects(req.db, req.tenantId, { activeOnly: req.query.active === 'true' }));
});
const createSubject = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createSubject(req.db, req.tenantId, subjectSchema.parse(req.body)));
});
const updateSubject = asyncHandler(async (req, res) => {
  const data = subjectSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  res.status(200).json(await service.updateSubject(req.db, req.tenantId, req.params.id, data));
});
const deleteSubject = asyncHandler(async (req, res) => {
  await service.deleteSubject(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

// ---- Plan de estudios del grado ----
const getGradeSubjects = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getGradeSubjects(req.db, req.tenantId, req.params.id));
});
const setGradeSubjects = asyncHandler(async (req, res) => {
  const schema = z.object({
    subjects: z.array(
      z.object({
        subjectId: z.string().uuid(),
        weeklyHours: z.number().int().positive().max(40).nullable().optional(),
      })
    ),
  });
  res.status(200).json(await service.setGradeSubjects(req.db, req.tenantId, req.params.id, schema.parse(req.body)));
});

// ---- Asignación docente por sección ----
const getSectionAssignments = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getSectionAssignments(req.db, req.tenantId, req.params.id));
});

// Acepta las dos formas; el servicio decide cuál corresponde según el nivel real del grado.
const assignmentSchema = z
  .object({
    leadTeacherId: uuidOrNull.optional(),
    assistantTeacherId: uuidOrNull.optional(),
    subjects: z.array(z.object({ subjectId: z.string().uuid(), teacherId: uuidOrNull })).optional(),
    // Secundaria: profesor guía / tutor del grupo (opcional; null lo quita).
    guideTeacherId: uuidOrNull.optional(),
  })
  .refine((b) => b.subjects !== undefined || b.leadTeacherId !== undefined || b.assistantTeacherId !== undefined || b.guideTeacherId !== undefined, {
    message: 'Envía la asignación de docentes de aula, el profesor guía o la lista de materias.',
  });

const setSectionAssignments = asyncHandler(async (req, res) => {
  const data = assignmentSchema.parse(req.body);
  res.status(200).json(await service.setSectionAssignments(req.db, req.tenantId, req.params.id, data));
});

// ---- Carga docente ----
const listTeachingLoad = asyncHandler(async (req, res) => {
  const schoolPeriodId = z.string().uuid().optional().parse(req.query.schoolPeriodId || undefined);
  res.status(200).json(await service.listTeachingLoad(req.db, req.tenantId, { schoolPeriodId }));
});

/** GET /academics/grades/:id/panel?schoolPeriodId= — todo lo del grado en una sola consulta. */
const getGradePanel = asyncHandler(async (req, res) => {
  // Id del grado mal formado (enlace mal copiado) → 400; inexistente → 404 (lo lanza el servicio).
  const gradeId = z.string().uuid({ message: 'El grado del enlace no es válido.' }).parse(req.params.id);
  const schoolPeriodId = z.string().uuid({ message: 'El año escolar no es válido.' }).optional().parse(req.query.schoolPeriodId || undefined);
  res.status(200).json(await service.getGradePanel(req.db, req.tenantId, gradeId, { schoolPeriodId }));
});

module.exports = {
  getGradePanel,
  listLevels,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getGradeSubjects,
  setGradeSubjects,
  getSectionAssignments,
  setSectionAssignments,
  listTeachingLoad,
};
