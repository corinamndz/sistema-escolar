const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

/**
 * Alcance del Coordinador (migración 047). Jerarquía: Director (Administrador)
 * > Coordinador > Docente.
 *
 * Un coordinador RESTRINGIDO es un usuario con el rol Coordinador que no puede
 * editar roles (quien edita roles es el Director: sin restricción, aunque
 * también sea coordinador). Su etapa sale de su ficha de personal
 * (staff.coordination_level). En Personal ve y gestiona solo a los DOCENTES
 * disponibles para su etapa (level_availability = su etapa o 'all') y solo
 * puede asignarles roles de menor jerarquía que la suya (Docente).
 */

const COORDINATOR_ROLE = 'Coordinador';
const LEVEL_LABELS = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };

/** { staffId, level, rank } o null si el usuario no es un coordinador restringido. */
async function loadCoordinatorScope(db, tenantId, userId, permissions) {
  const perms = permissions || (await getEffectivePermissions(db, tenantId, userId));
  if (perms.roles?.can_update) return null; // Director: sin restricción
  const roles = await db('roles as r').join('user_roles as ur', 'ur.role_id', 'r.id').where({ 'ur.user_id': userId, 'r.tenant_id': tenantId }).select('r.name', 'r.hierarchy_level');
  const coordinator = roles.find((r) => r.name === COORDINATOR_ROLE);
  if (!coordinator) return null;
  const staff = await db('staff').where({ tenant_id: tenantId, user_id: userId }).first('id', 'coordination_level');
  return { staffId: staff?.id || null, level: staff?.coordination_level || null, rank: coordinator.hierarchy_level ?? 2 };
}

/** Igual, por petición (se calcula una vez). */
async function getCoordinatorScope(req) {
  if (req.coordinatorScope !== undefined) return req.coordinatorScope;
  req.coordinatorScope = await loadCoordinatorScope(req.db, req.tenantId, req.user.id, req.permissions);
  return req.coordinatorScope;
}

/** Sin etapa asignada no puede gestionar a nadie: la asigna el Director. */
function assertHasLevel(scope) {
  if (scope && !scope.level) {
    throw ApiError.forbidden('Tu usuario de coordinador no tiene una etapa asignada. Pide al Director que la asigne en Personal.');
  }
}

/** ¿El miembro del personal está en el área del coordinador? (docente de su etapa o de todas). */
const coversStaff = (scope, staff) =>
  !scope || (staff.staff_type === 'teaching' && (staff.level_availability === scope.level || staff.level_availability === 'all' || !staff.level_availability));

/** 404 (no revela que existe) si el empleado no es un docente de su etapa. */
async function assertStaffAccess(req, staffId) {
  const scope = await getCoordinatorScope(req);
  if (!scope) return;
  assertHasLevel(scope);
  const staff = await req.db('staff').where({ id: staffId, tenant_id: req.tenantId }).first();
  if (!staff || !coversStaff(scope, staff)) throw ApiError.notFound('Personal no encontrado o fuera de tu etapa de coordinación.');
}

/** Middleware: valida `req.params[param]` contra el alcance del coordinador. */
const guardStaff = (param = 'id') => async (req, res, next) => {
  try {
    await assertStaffAccess(req, req.params[param]);
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { COORDINATOR_ROLE, LEVEL_LABELS, loadCoordinatorScope, getCoordinatorScope, assertHasLevel, coversStaff, assertStaffAccess, guardStaff };
