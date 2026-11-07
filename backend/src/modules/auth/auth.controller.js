const { z } = require('zod');
const authService = require('./auth.service');
const passwordReset = require('./passwordReset.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { getTeacherScope } = require('../access/teacherScope');
const { loadCoordinatorScope } = require('../access/coordinatorScope');
const audit = require('../../services/audit/audit.service');
const { isAdmin, isAdmissions } = require('../../middlewares/admin.middleware');

const loginSchema = z.object({
  tenantSlug: z.string().min(1, 'tenantSlug es requerido.'),
  username: z.string().min(1),
  password: z.string().min(1),
});

const login = asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data, audit.requestContext(req));
  res.status(200).json(result);
});

const refresh = asyncHandler(async (req, res) => {
  const schema = z.object({ refreshToken: z.string().min(1) });
  const { refreshToken } = schema.parse(req.body);
  const result = await authService.refresh({ refreshToken });
  res.status(200).json(result);
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.db, req.tenantId, req.user.id);
  const permissions = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
  req.permissions = permissions;
  // Docente restringido a su carga: el frontend oculta pagos y cierre/promoción (el backend igual responde 403).
  const scope = await getTeacherScope(req);
  // Ficha de personal DOCENTE vinculada (para "Mi horario").
  const staff = await req.db('staff').where({ tenant_id: req.tenantId, user_id: req.user.id, staff_type: 'teaching' }).select('id').first();
  // Coordinador restringido (Director > Coordinador > Docente): su etapa, para adaptar Personal y el menú.
  const coord = await loadCoordinatorScope(req.db, req.tenantId, req.user.id, permissions);
  res.status(200).json({
    ...user,
    permissions,
    isRestrictedTeacher: Boolean(scope),
    teachingStaffId: staff?.id || null,
    coordinator: coord ? { level: coord.level } : null,
    // Director (rol de sistema Administrador): módulos exclusivos como Auditoría.
    isAdmin: await isAdmin(req.db, req.tenantId, req.user.id),
    // Rol Admisiones (migración 083): planillas de inscripción y consulta de alumnos.
    isAdmissions: await isAdmissions(req.db, req.tenantId, req.user.id),
  });
});

const changePassword = asyncHandler(async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres.'),
  });
  const data = schema.parse(req.body);
  await authService.changePassword(req.db, req.tenantId, req.user.id, data);
  res.status(200).json({ message: 'Contraseña actualizada.' });
});

// ---- Recuperación de contraseña (públicas: el colegio llega por su identificador de la URL) ----

const forgotPassword = asyncHandler(async (req, res) => {
  const schema = z.object({
    tenantSlug: z.string().min(1, 'tenantSlug es requerido.'),
    email: z.string().trim().email('Ingresa un correo electrónico válido.').max(150),
  });
  const data = schema.parse(req.body);
  res.status(200).json(await passwordReset.requestReset(data, audit.requestContext(req)));
});

// El token del enlace: 32 bytes en base64url (43 caracteres).
const tokenField = z.string().min(20, 'El enlace no es válido.').max(200);

const verifyResetToken = asyncHandler(async (req, res) => {
  const schema = z.object({ tenantSlug: z.string().min(1), token: tokenField });
  res.status(200).json(await passwordReset.verifyToken(schema.parse(req.body)));
});

const resetPassword = asyncHandler(async (req, res) => {
  const schema = z.object({
    tenantSlug: z.string().min(1),
    token: tokenField,
    newPassword: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres.').max(128),
  });
  res.status(200).json(await passwordReset.resetPassword(schema.parse(req.body), audit.requestContext(req)));
});

const createUser = asyncHandler(async (req, res) => {
  const schema = z.object({
    username: z.string().min(3),
    password: z.string().min(8),
    fullName: z.string().min(1),
    roleIds: z.array(z.string().uuid()).default([]),
  });
  const data = schema.parse(req.body);
  const user = await authService.createUser(req.db, req.tenantId, data);
  res.status(201).json(user);
});

module.exports = { login, refresh, me, changePassword, createUser, forgotPassword, verifyResetToken, resetPassword };
