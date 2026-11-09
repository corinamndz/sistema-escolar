const { z } = require('zod');
const service = require('./student.service');
const academicRecord = require('../academics/academicRecord.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const teacherScope = require('../access/teacherScope');
const feePlans = require('../payments/feePlan.service');
const enrollmentStatus = require('../enrollment-forms/enrollmentStatus');
const withdrawals = require('./studentWithdrawal.service');

const relationshipSchema = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(30, 'Máximo 30 caracteres.').nullable().optional());

/**
 * Vínculos N:M (student_guardians) enviados desde los formularios: la lista
 * COMPLETA deseada (se agregan, actualizan y quitan las diferencias).
 * Sin el campo, los vínculos no se tocan.
 */
const guardianLinksSchema = z
  .array(z.object({ guardianId: z.string().uuid(), relationship: relationshipSchema, isPrimary: z.boolean().default(false) }))
  .max(10, 'Máximo 10 representantes por alumno.')
  .refine((list) => new Set(list.map((g) => g.guardianId)).size === list.length, 'Hay un representante repetido.')
  .optional();
const studentLinksSchema = z
  .array(z.object({ studentId: z.string().uuid(), relationship: relationshipSchema, isPrimary: z.boolean().default(false) }))
  .max(50, 'Máximo 50 alumnos por representante.')
  .refine((list) => new Set(list.map((s) => s.studentId)).size === list.length, 'Hay un alumno repetido.')
  .optional();

const studentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.string().optional(),
  nationalId: z.string().optional(),
  guardians: guardianLinksSchema,
  // Tarifa aplicable: id de una tarifa especial (beca, convenio) o null = tarifa general del nivel.
  // Se omite si no cambia. Es dato financiero: exige además editar Pagos.
  feePlanId: z.string().uuid('Tarifa inválida.').nullable().optional(),
});

/**
 * Asociar es editar AMBOS registros: desde la ficha del alumno se exige además
 * leer representantes; desde la del representante, poder editar alumnos (igual
 * que POST /students/:id/guardians).
 */
const can = (req, module, action) => Boolean(req.permissions?.[module]?.[`can_${action}`]);
function assertCanLink(req, { fromStudent }) {
  if (fromStudent && !can(req, 'guardians', 'read')) throw ApiError.forbidden('Para asociar representantes necesitas permiso para ver Representantes.');
  if (!fromStudent && !can(req, 'students', 'update')) throw ApiError.forbidden('Para asociar alumnos necesitas permiso para editar Alumnos.');
}

/**
 * Tarifa del alumno desde el formulario: misma operación que la ficha
 * (feePlan.assignStudentFeePlan), en la misma transacción que el resto de los
 * cambios. Devuelve cuántas mensualidades pendientes se recalcularon (o null).
 */
async function applyFeePlan(req, studentId, feePlanId) {
  if (feePlanId === undefined) return null;
  if (!can(req, 'payments', 'update')) throw ApiError.forbidden('Para cambiar la tarifa necesitas permiso para editar Pagos.');
  const current = await req.db('students').where({ id: studentId, tenant_id: req.tenantId }).first('fee_plan_id');
  if ((current?.fee_plan_id || null) === feePlanId) return null;
  const { applied } = await feePlans.assignStudentFeePlan(req.db, req.tenantId, studentId, { feePlanId });
  return applied;
}

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
  students: studentLinksSchema,
});

const linkSchema = z.object({
  guardianId: z.string().uuid(),
  relationship: z.string().min(1),
  isPrimary: z.boolean().default(false),
});

// ---- Alumnos ----

const listStudents = asyncHandler(async (req, res) => {
  const scope = await teacherScope.getTeacherScope(req);
  const rows = await service.listStudents(req.db, req.tenantId, {
    status: req.query.status,
    // Sin estado pedido, los retirados no se listan: quien los necesita lo indica.
    includeWithdrawn: req.query.includeWithdrawn === 'true',
    availableFor: req.query.availableFor || null,
    // Año escolar del estatus «Inscrito / No inscrito» (por defecto, el vigente).
    enrollmentPeriodId: z.string().uuid().safeParse(req.query.enrollmentPeriodId).success ? req.query.enrollmentPeriodId : null,
    scope,
  });
  res.status(200).json(rows);
});

/** GET /students/enrollment-periods — años para el selector «Inscripción de…» del listado. */
const listEnrollmentPeriods = asyncHandler(async (req, res) => {
  res.status(200).json(await enrollmentStatus.selectablePeriods(req.db, req.tenantId));
});

const getStudent = asyncHandler(async (req, res) => {
  const row = await service.getStudentById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const createStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.parse(req.body);
  if (data.guardians) assertCanLink(req, { fromStudent: true });
  // Sin tarifa elegida, el alumno nace con la tarifa general de su nivel (fee_plan_id null).
  if (data.feePlanId && !can(req, 'payments', 'update')) throw ApiError.forbidden('Para asignar una tarifa necesitas permiso para editar Pagos.');
  const row = await service.createStudent(req.db, req.tenantId, data);
  const feeApplied = data.feePlanId ? await applyFeePlan(req, row.id, data.feePlanId) : null;
  res.status(201).json({ ...row, fee_plan_id: data.feePlanId || null, fee_applied: feeApplied });
});

const updateStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.partial().extend({ status: z.enum(['active', 'inactive', 'graduated', 'withdrawn']).optional() }).parse(req.body);
  if (data.guardians) assertCanLink(req, { fromStudent: true });
  const row = await service.updateStudent(req.db, req.tenantId, req.params.id, data);
  const feeApplied = await applyFeePlan(req, row.id, data.feePlanId);
  res.status(200).json({ ...row, ...(data.feePlanId !== undefined ? { fee_plan_id: data.feePlanId } : {}), fee_applied: feeApplied });
});

const withdrawSchema = z.object({
  withdrawnOn: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').nullable().optional()),
  reason: optionalText(z.string().trim().max(500, 'Máximo 500 caracteres.')),
});

/** POST /students/:id/withdraw — retiro lógico. Fecha (por defecto, hoy) y motivo opcionales. */
const withdrawStudent = asyncHandler(async (req, res) => {
  const data = withdrawSchema.parse(req.body || {});
  res.status(200).json(await withdrawals.withdrawStudent(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id), data));
});

/** POST /students/:id/reactivate — reincorpora al alumno retirado y le devuelve sus matrículas si se puede. */
const reactivateStudent = asyncHandler(async (req, res) => {
  res.status(200).json(await withdrawals.reactivateStudent(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id)));
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
  if (data.students) assertCanLink(req, { fromStudent: false });
  const row = await service.createGuardian(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const updateGuardian = asyncHandler(async (req, res) => {
  const data = guardianSchema.partial().parse(req.body);
  if (data.students) assertCanLink(req, { fromStudent: false });
  const row = await service.updateGuardian(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

/** PUT /guardians/:id/portal — crear o gestionar solo el acceso al portal: { portal, temporaryPassword }. */
const updateGuardianPortal = asyncHandler(async (req, res) => {
  // Errores con la misma ruta que en el formulario del representante ("portal.email", "portal.password").
  const { portal } = z.object({ portal: portalSchema.unwrap() }).parse({ portal: req.body });
  res.status(200).json(await service.updateGuardianPortal(req.db, req.tenantId, req.params.id, portal));
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
  withdrawStudent,
  reactivateStudent,
  listStudents,
  listEnrollmentPeriods,
  getAcademicHistory,
  getStudent,
  createStudent,
  updateStudent,
  listGuardians,
  getGuardian,
  createGuardian,
  updateGuardian,
  updateGuardianPortal,
  deleteGuardian,
  linkGuardian,
  unlinkGuardian,
};
