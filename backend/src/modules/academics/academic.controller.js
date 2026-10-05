const { z } = require('zod');
const service = require('./academic.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const teacherScope = require('../access/teacherScope');

// ---- Periodos escolares ----
const listSchoolPeriods = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listSchoolPeriods(req.db, req.tenantId));
});
const createSchoolPeriod = asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(1), startDate: z.string().optional(), endDate: z.string().optional() });
  const data = schema.parse(req.body);
  res.status(201).json(await service.createSchoolPeriod(req.db, req.tenantId, data));
});

// ---- Aulas ----
const listClassrooms = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listClassrooms(req.db, req.tenantId));
});
const createClassroom = asyncHandler(async (req, res) => {
  const schema = z.object({ name: z.string().min(1), capacity: z.number().int().positive().optional() });
  const data = schema.parse(req.body);
  res.status(201).json(await service.createClassroom(req.db, req.tenantId, data));
});

// ---- Grados ----
const LEVEL_CODES = ['initial', 'primary', 'secondary'];
const gradeSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.'),
  sortOrder: z.number().int().optional(),
  levelCode: z.enum(LEVEL_CODES, { errorMap: () => ({ message: 'Selecciona el nivel educativo.' }) }),
});

const listGrades = asyncHandler(async (req, res) => {
  const levelCode = z.enum(LEVEL_CODES).optional().parse(req.query.levelCode || undefined);
  res.status(200).json(await service.listGrades(req.db, req.tenantId, { levelCode }));
});
const createGrade = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createGrade(req.db, req.tenantId, gradeSchema.parse(req.body)));
});
const updateGrade = asyncHandler(async (req, res) => {
  res.status(200).json(await service.updateGrade(req.db, req.tenantId, req.params.id, gradeSchema.partial().parse(req.body)));
});

// ---- Secciones ----
const sectionSchema = z.object({
  gradeId: z.string().uuid(),
  schoolPeriodId: z.string().uuid(),
  classroomId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1),
  maxStudents: z.number().int().positive().optional(),
});

const listSections = asyncHandler(async (req, res) => {
  const { schoolPeriodId, gradeId, levelCode } = req.query;
  const rows = await service.listSections(req.db, req.tenantId, { schoolPeriodId, gradeId, levelCode });
  // Docente: solo las secciones de su carga.
  const scope = await teacherScope.getTeacherScope(req);
  res.status(200).json(scope ? rows.filter((s) => teacherScope.coversSection(scope, s.id)) : rows);
});
const getSection = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getSectionById(req.db, req.tenantId, req.params.id));
});
const createSection = asyncHandler(async (req, res) => {
  const data = sectionSchema.parse(req.body);
  res.status(201).json(await service.createSection(req.db, req.tenantId, data));
});
const updateSection = asyncHandler(async (req, res) => {
  // El grado y el año escolar no se cambian: moverían la sección de nivel y dejarían asignaciones inválidas.
  const data = sectionSchema.omit({ gradeId: true, schoolPeriodId: true }).partial().parse(req.body);
  res.status(200).json(await service.updateSection(req.db, req.tenantId, req.params.id, data));
});
const getRoster = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listSectionRoster(req.db, req.tenantId, req.params.id));
});

// ---- Inscripciones ----
const enroll = asyncHandler(async (req, res) => {
  const schema = z.object({ studentId: z.string().uuid(), sectionId: z.string().uuid() });
  const data = schema.parse(req.body);
  res.status(201).json(await service.enrollStudent(req.db, req.tenantId, data));
});
const withdraw = asyncHandler(async (req, res) => {
  await service.withdrawEnrollment(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

module.exports = {
  listSchoolPeriods,
  createSchoolPeriod,
  listClassrooms,
  createClassroom,
  listGrades,
  createGrade,
  updateGrade,
  listSections,
  getSection,
  createSection,
  updateSection,
  getRoster,
  enroll,
  withdraw,
};
