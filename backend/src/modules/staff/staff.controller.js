const { z } = require('zod');
const staffService = require('./staff.service');
const staffAccess = require('./staffAccess.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const staffSchema = z.object({
  userId: z.string().uuid().optional(),
  staffType: z.enum(['administrative', 'teaching', 'support']),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  hiredAt: z.string().optional(), // 'YYYY-MM-DD'
});

const list = asyncHandler(async (req, res) => {
  const { staffType } = req.query;
  const rows = await staffService.list(req.db, req.tenantId, { staffType });
  res.status(200).json(rows);
});

const getOne = asyncHandler(async (req, res) => {
  const row = await staffService.getById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const create = asyncHandler(async (req, res) => {
  const data = staffSchema.parse(req.body);
  const row = await staffService.create(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const update = asyncHandler(async (req, res) => {
  const data = staffSchema.partial().extend({ status: z.enum(['active', 'inactive']).optional() }).parse(req.body);
  const row = await staffService.update(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

const remove = asyncHandler(async (req, res) => {
  await staffService.remove(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

// ---- Usuario de acceso del empleado ----
// Contraseña elegida por el admin (si se omite, se genera una temporal). Máx. 72: límite de bcrypt.
const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres.')
  .max(72, 'Máximo 72 caracteres.')
  .regex(/[A-Za-z]/, 'Debe incluir al menos una letra.')
  .regex(/\d/, 'Debe incluir al menos un número.');
const emptyToUndefined = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const getAccess = asyncHandler(async (req, res) => {
  res.status(200).json(await staffAccess.getStaffAccess(req.db, req.tenantId, req.params.id));
});

const createAccess = asyncHandler(async (req, res) => {
  const data = z
    .object({
      email: z.string().trim().email('Correo inválido.').max(150),
      password: emptyToUndefined(passwordSchema),
      roleIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un rol.'),
    })
    .parse(req.body);
  res.status(201).json(await staffAccess.createStaffAccess(req.db, req.tenantId, req.params.id, data));
});

const updateAccess = asyncHandler(async (req, res) => {
  const data = z
    .object({
      email: emptyToUndefined(z.string().trim().email('Correo inválido.').max(150)),
      password: emptyToUndefined(passwordSchema),
      resetPassword: z.boolean().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      roleIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un rol.').optional(),
    })
    .parse(req.body);
  res.status(200).json(await staffAccess.updateStaffAccess(req.db, req.tenantId, req.params.id, data, req.user.id));
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  getAccess,
  createAccess,
  updateAccess,
};
