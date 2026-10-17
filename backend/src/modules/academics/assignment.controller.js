const { z } = require('zod');
const service = require('./assignment.service');
const subjectAssignments = require('./subjectAssignment.service');
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

/**
 * GET /academics/subjects?active=true&schoolPeriodId= — con `schoolPeriodId`
 * cada materia trae `offering`: grados, secciones donde se dicta ese año y
 * cuántas tienen docente (resumen para la tabla del módulo de Materias).
 */
const listSubjects = asyncHandler(async (req, res) => {
  const schoolPeriodId = z.string().uuid({ message: 'El año escolar no es válido.' }).optional().parse(req.query.schoolPeriodId || undefined);
  const rows = await service.listSubjects(req.db, req.tenantId, { activeOnly: req.query.active === 'true' });
  if (!schoolPeriodId) return res.status(200).json(rows);
  const summary = await subjectAssignments.summarizeSubjects(req.db, req.tenantId, { schoolPeriodId });
  const empty = { grades: [], sections_available: 0, sections_covered: 0, sections_missing: 0 };
  return res.status(200).json(rows.map((s) => ({ ...s, offering: summary[s.id] || empty })));
});

// ---- Módulo de Materias: grados, secciones y docente de cada sección ----
const assignmentsSchema = z.object({
  grades: z
    .array(
      z.object({
        gradeId: z.string().uuid(),
        weeklyHours: z.number().int().positive().max(40).nullable().optional(),
        sections: z
          .array(z.object({ sectionId: z.string().uuid(), available: z.boolean(), teacherId: uuidOrNull.optional() }))
          .max(200)
          .optional(),
      })
    )
    .max(100),
});
const periodOf = (req) =>
  z.string().uuid({ message: 'El año escolar no es válido.' }).optional().parse(req.query.schoolPeriodId || req.body?.schoolPeriodId || undefined);

/**
 * GET /academics/subjects/:id/assignments?schoolPeriodId= — detalle para el formulario de la materia.
 * GET /academics/subjects/assignment-options?schoolPeriodId= — lo mismo, vacío, para una materia nueva.
 */
const getSubjectAssignments = asyncHandler(async (req, res) => {
  const subjectId = req.params.id ? z.string().uuid({ message: 'La materia del enlace no es válida.' }).parse(req.params.id) : null;
  res.status(200).json(await subjectAssignments.getSubjectAssignments(req.db, req.tenantId, subjectId, { schoolPeriodId: periodOf(req) }));
});
/** PUT /academics/subjects/:id/assignments — { schoolPeriodId?, grades: [{ gradeId, weeklyHours?, sections?: [{ sectionId, available, teacherId? }] }] } */
const setSubjectAssignments = asyncHandler(async (req, res) => {
  const body = assignmentsSchema.parse(req.body);
  const removed = await subjectAssignments.setSubjectAssignments(req.db, req.tenantId, req.params.id, body);
  const detail = await subjectAssignments.getSubjectAssignments(req.db, req.tenantId, req.params.id, { schoolPeriodId: periodOf(req) });
  res.status(200).json({ ...detail, ...removed });
});
// Grados donde se dicta la materia (selector múltiple): si viene, reemplaza la lista.
const gradeIds = z.array(z.string().uuid()).max(100).optional();

// Módulo de Materias: grados, secciones y docentes en el mismo guardado (misma transacción).
const withAssignments = { assignments: assignmentsSchema.optional() };

/** POST /academics/subjects — { name, code?, description?, gradeIds? | assignments? } */
const createSubject = asyncHandler(async (req, res) => {
  const { gradeIds: grades, assignments, ...data } = subjectSchema.extend({ gradeIds, ...withAssignments }).parse(req.body);
  const subject = await service.createSubject(req.db, req.tenantId, data);
  if (grades) await service.setSubjectGrades(req.db, req.tenantId, subject.id, grades);
  const removed = assignments ? await subjectAssignments.setSubjectAssignments(req.db, req.tenantId, subject.id, assignments) : {};
  res.status(201).json({ ...(await service.getSubjectWithGrades(req.db, req.tenantId, subject.id)), ...removed });
});
/** PUT /academics/subjects/:id — { name?, code?, description?, isActive?, gradeIds? | assignments? } */
const updateSubject = asyncHandler(async (req, res) => {
  const { gradeIds: grades, assignments, ...data } = subjectSchema
    .partial()
    .extend({ isActive: z.boolean().optional(), gradeIds, ...withAssignments })
    .parse(req.body);
  // Solo los grados (sin cambiar nombre/código/estado): no hay nada que actualizar en la materia.
  if (Object.keys(data).length) await service.updateSubject(req.db, req.tenantId, req.params.id, data);
  if (grades) await service.setSubjectGrades(req.db, req.tenantId, req.params.id, grades);
  const removed = assignments ? await subjectAssignments.setSubjectAssignments(req.db, req.tenantId, req.params.id, assignments) : {};
  res.status(200).json({ ...(await service.getSubjectWithGrades(req.db, req.tenantId, req.params.id)), ...removed });
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
  getSubjectAssignments,
  setSubjectAssignments,
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
