const { z } = require('zod');
const staffService = require('./staff.service');
const staffAccess = require('./staffAccess.service');
const coordinator = require('../access/coordinatorScope');
const { ApiError } = require('../../utils/ApiError');
const { asyncHandler } = require('../../utils/asyncHandler');

const staffSchema = z.object({
  userId: z.string().uuid().optional(),
  // 'coordinator' (migración 048): exige coordinationLevel. Jerarquía Director > Coordinador > Docente.
  staffType: z.enum(['administrative', 'teaching', 'support', 'coordinator']),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  hiredAt: z.string().optional(), // 'YYYY-MM-DD'
  // Nivel en que puede trabajar el docente (solo aplica al personal docente).
  levelAvailability: z.enum(['initial', 'primary', 'secondary', 'all']).optional(),
  // Etapa que coordina (solo para el tipo Coordinador).
  coordinationLevel: z.enum(['initial', 'primary', 'secondary']).nullable().optional(),
});
const coordinationLevel = z.enum(['initial', 'primary', 'secondary']).nullable().optional();

/**
 * Coordinador restringido: solo DOCENTES de su etapa. Lo que pida otro tipo de
 * personal o una disponibilidad fuera de su etapa se rechaza (no se corrige en
 * silencio, para que sepa por qué).
 */
function assertCoordinatorData(scope, data, { creating, current = null }) {
  if (!scope) return data;
  coordinator.assertHasLevel(scope);
  const label = coordinator.LEVEL_LABELS[scope.level];
  // Estricto: registra docentes de SU nivel; al editar puede dejar la disponibilidad que ya tenía.
  const allowed = [scope.level, ...(current?.level_availability && current.level_availability !== scope.level ? [current.level_availability] : [])];
  if ((creating || data.staffType !== undefined) && (data.staffType || 'teaching') !== 'teaching') {
    throw ApiError.forbidden(`Como coordinador de ${label} solo gestionas personal docente.`, [{ path: 'staffType', message: 'Solo docentes.' }]);
  }
  if (data.levelAvailability !== undefined && !allowed.includes(data.levelAvailability)) {
    throw ApiError.forbidden(`Como coordinador de ${label} solo registras docentes de ${label}.`, [{ path: 'levelAvailability', message: `Solo ${label}.` }]);
  }
  return { ...data, staffType: 'teaching', ...(creating ? { levelAvailability: data.levelAvailability || scope.level } : {}) };
}

const actorOf = async (req) => {
  const scope = await coordinator.getCoordinatorScope(req);
  return scope ? { coordinator: scope } : null;
};

const list = asyncHandler(async (req, res) => {
  const { staffType } = req.query;
  const scope = await coordinator.getCoordinatorScope(req);
  if (scope) coordinator.assertHasLevel(scope);
  const rows = await staffService.list(req.db, req.tenantId, { staffType, coordinator: scope });
  res.status(200).json(rows);
});

const getOne = asyncHandler(async (req, res) => {
  const row = await staffService.getById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const create = asyncHandler(async (req, res) => {
  const scope = await coordinator.getCoordinatorScope(req);
  const data = assertCoordinatorData(scope, staffSchema.extend({ staffType: staffSchema.shape.staffType.optional() }).parse(req.body), { creating: true });
  if (!data.staffType) throw ApiError.badRequest('Indica el tipo de personal.', [{ path: 'staffType', message: 'Requerido.' }]);
  const row = await staffService.create(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const update = asyncHandler(async (req, res) => {
  const scope = await coordinator.getCoordinatorScope(req);
  const parsed = staffSchema.partial().extend({ status: z.enum(['active', 'inactive']).optional() }).parse(req.body);
  const current = scope ? await req.db('staff').where({ id: req.params.id, tenant_id: req.tenantId }).first('level_availability') : null;
  const data = scope ? assertCoordinatorData(scope, parsed, { creating: false, current }) : parsed;
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

/** GET /staff/access/roles — roles que el usuario puede asignar (el coordinador: solo los de menor jerarquía). */
const assignableRoles = asyncHandler(async (req, res) => {
  res.status(200).json(await staffAccess.listAssignableRoles(req.db, req.tenantId, await actorOf(req)));
});

const createAccess = asyncHandler(async (req, res) => {
  const data = z
    .object({
      email: z.string().trim().email('Correo inválido.').max(150),
      password: emptyToUndefined(passwordSchema),
      roleIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un rol.'),
      coordinationLevel,
    })
    .parse(req.body);
  res.status(201).json(await staffAccess.createStaffAccess(req.db, req.tenantId, req.params.id, data, await actorOf(req)));
});

const updateAccess = asyncHandler(async (req, res) => {
  const data = z
    .object({
      email: emptyToUndefined(z.string().trim().email('Correo inválido.').max(150)),
      password: emptyToUndefined(passwordSchema),
      resetPassword: z.boolean().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      roleIds: z.array(z.string().uuid()).min(1, 'Selecciona al menos un rol.').optional(),
      coordinationLevel,
    })
    .parse(req.body);
  res.status(200).json(await staffAccess.updateStaffAccess(req.db, req.tenantId, req.params.id, data, req.user.id, await actorOf(req)));
});

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  getAccess,
  assignableRoles,
  createAccess,
  updateAccess,
};
