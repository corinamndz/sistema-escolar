const { z } = require('zod');
const authService = require('./auth.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { getTeacherScope } = require('../access/teacherScope');

const loginSchema = z.object({
  tenantSlug: z.string().min(1, 'tenantSlug es requerido.'),
  username: z.string().min(1),
  password: z.string().min(1),
});

const login = asyncHandler(async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data);
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
  res.status(200).json({ ...user, permissions, isRestrictedTeacher: Boolean(scope), teachingStaffId: staff?.id || null });
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

module.exports = { login, refresh, me, changePassword, createUser };
