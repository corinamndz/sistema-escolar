const { z } = require('zod');
const service = require('./student.service');
const { asyncHandler } = require('../../utils/asyncHandler');

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
  const rows = await service.listStudents(req.db, req.tenantId, { status: req.query.status });
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
