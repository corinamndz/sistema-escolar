const { z } = require('zod');
const service = require('./assignment.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const teacherScope = require('../access/teacherScope');

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
  })
  .refine((b) => b.subjects !== undefined || b.leadTeacherId !== undefined || b.assistantTeacherId !== undefined, {
    message: 'Envía la asignación de docentes de aula o la lista de materias.',
  });

const setSectionAssignments = asyncHandler(async (req, res) => {
  const data = assignmentSchema.parse(req.body);
  res.status(200).json(await service.setSectionAssignments(req.db, req.tenantId, req.params.id, data));
});

// ---- Carga docente ----
const listTeachingLoad = asyncHandler(async (req, res) => {
  const schoolPeriodId = z.string().uuid().optional().parse(req.query.schoolPeriodId || undefined);
  const rows = await service.listTeachingLoad(req.db, req.tenantId, { schoolPeriodId });
  // Docente: solo su propia carga.
  const scope = await teacherScope.getTeacherScope(req);
  res.status(200).json(scope ? rows.filter((t) => t.id === scope.staffId) : rows);
});

module.exports = {
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
