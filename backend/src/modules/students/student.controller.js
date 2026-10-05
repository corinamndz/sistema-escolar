const { z } = require('zod');
const service = require('./student.service');
const academicRecord = require('../academics/academicRecord.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const teacherScope = require('../access/teacherScope');

const studentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.string().optional(),
  nationalId: z.string().optional(),
});

// Un input vacío llega como "": se guarda como null (así, al editar, borrar el
// teléfono o el correo realmente lo borra, y un correo vacío no falla .email()).
const optionalText = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());

// Contraseña elegida por el administrador (si se omite, el backend genera una temporal).
// Máximo 72: bcrypt ignora lo que pase de 72 bytes.
const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .max(72, 'Máximo 72 caracteres.')
  .regex(/[A-Za-z]/, 'Debe incluir al menos una letra.')
  .regex(/\d/, 'Debe incluir al menos un número.');

/**
 * Acceso al portal (todo opcional):
 *   crear:        { enabled: true, email, password? }
 *   actualizar:   { email?, resetPassword?, password?, status? }
 */
const portalSchema = z
  .object({
    enabled: z.boolean().optional(),
    email: optionalText(z.string().trim().email('Correo inválido.').max(150)),
    password: optionalText(passwordSchema),
    resetPassword: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .optional();

const guardianSchema = z.object({
  userId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1, 'El nombre es obligatorio.'),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio.'),
  nationalId: optionalText(z.string().trim().max(30)),
  phone: optionalText(z.string().trim().max(30)),
  email: optionalText(z.string().trim().email('Correo inválido.').max(150)),
  portal: portalSchema,
});

const linkSchema = z.object({
  guardianId: z.string().uuid(),
  relationship: z.string().min(1),
  isPrimary: z.boolean().default(false),
});

// ---- Alumnos ----

const listStudents = asyncHandler(async (req, res) => {
  const scope = await teacherScope.getTeacherScope(req);
  const rows = await service.listStudents(req.db, req.tenantId, { status: req.query.status, scope });
  res.status(200).json(rows);
});

const getStudent = asyncHandler(async (req, res) => {
  const row = await service.getStudentById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const createStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.parse(req.body);
  const row = await service.createStudent(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const updateStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.partial().extend({ status: z.enum(['active', 'inactive', 'graduated', 'withdrawn']).optional() }).parse(req.body);
  const row = await service.updateStudent(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

/** GET /students/:id/academic-history — años cursados con grado, resultado y notas por materia. */
const getAcademicHistory = asyncHandler(async (req, res) => {
  const history = await academicRecord.getStudentHistory(req.db, req.tenantId, req.params.id);
  // Docente: solo los años cursados en secciones de su carga y, de cada año,
  // solo las materias que dicta (no ve las notas de otros profesores).
  const scope = await teacherScope.getTeacherScope(req);
  if (scope) {
    history.years = history.years
      .filter((y) => teacherScope.coversSection(scope, y.section_id))
      .map((y) => ({
        ...y,
        subjects: y.subjects.filter((s) => teacherScope.coversSubject(scope, y.section_id, s.subject_id || null)),
        // El promedio general y las reprobadas mezclan materias de otros docentes.
        final_average: null,
        failed_subjects: null,
        restricted: true,
      }));
  }
  res.status(200).json(history);
});

// ---- Representantes ----

const listGuardians = asyncHandler(async (req, res) => {
  const rows = await service.listGuardians(req.db, req.tenantId);
  res.status(200).json(rows);
});

const getGuardian = asyncHandler(async (req, res) => {
  const row = await service.getGuardianById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const createGuardian = asyncHandler(async (req, res) => {
  const data = guardianSchema.parse(req.body);
  const row = await service.createGuardian(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const updateGuardian = asyncHandler(async (req, res) => {
  const data = guardianSchema.partial().parse(req.body);
  const row = await service.updateGuardian(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

const deleteGuardian = asyncHandler(async (req, res) => {
  await service.deleteGuardian(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

// ---- Asociación ----

const linkGuardian = asyncHandler(async (req, res) => {
  const data = linkSchema.parse(req.body);
  const row = await service.linkGuardian(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

const unlinkGuardian = asyncHandler(async (req, res) => {
  await service.unlinkGuardian(req.db, req.tenantId, req.params.id, req.params.guardianId);
  res.status(204).send();
});

module.exports = {
  listStudents,
  getAcademicHistory,
  getStudent,
  createStudent,
  updateStudent,
  listGuardians,
  getGuardian,
  createGuardian,
  updateGuardian,
  deleteGuardian,
  linkGuardian,
  unlinkGuardian,
};
