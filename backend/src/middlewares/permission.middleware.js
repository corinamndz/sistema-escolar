const { ApiError } = require('../utils/ApiError');
const cache = require('../utils/cache');

const CRUD_ACTIONS = ['create', 'read', 'update', 'delete'];

/**
 * Combina los permisos de TODOS los roles del usuario (OR lógico por
 * permiso: si cualquiera de sus roles puede editar, puede editar) y los
 * cachea 5 minutos por (tenant, usuario) para no recalcular en cada request.
 *
 * Usa `req.db` (la transacción abierta por tenant.middleware), así que ya
 * corre bajo RLS con `app.tenant_id` fijado.
 */
async function getEffectivePermissions(db, tenantId, userId) {
  const cacheKey = `perm:${tenantId}:${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const rows = await db('role_permissions as rp')
    .join('user_roles as ur', 'ur.role_id', 'rp.role_id')
    .join('modules as m', 'm.id', 'rp.module_id')
    .where('ur.user_id', userId)
    .andWhere('rp.tenant_id', tenantId)
    .select(
      'm.code as module_code',
      'rp.can_create',
      'rp.can_read',
      'rp.can_update',
      'rp.can_delete',
      'rp.extra_actions'
    );

  const merged = rows.reduce((acc, row) => {
    const prev = acc[row.module_code] || {
      can_create: false,
      can_read: false,
      can_update: false,
      can_delete: false,
      extra_actions: {},
    };
    acc[row.module_code] = {
      can_create: prev.can_create || row.can_create,
      can_read: prev.can_read || row.can_read,
      can_update: prev.can_update || row.can_update,
      can_delete: prev.can_delete || row.can_delete,
      extra_actions: { ...prev.extra_actions, ...row.extra_actions },
    };
    return acc;
  }, {});

  cache.set(cacheKey, merged, { ttlSeconds: 300 });
  return merged;
}

/** Invalida la caché de permisos de un usuario (o de todo el tenant si no se pasa userId). */
function invalidatePermissionsCache(tenantId, userId) {
  if (userId) cache.del(`perm:${tenantId}:${userId}`);
  else cache.delByPrefix(`perm:${tenantId}:`);
}

/**
 * Middleware factory: `requirePermission('students', 'update')`.
 * `action` es 'create' | 'read' | 'update' | 'delete', o el nombre de una
 * acción especial declarada en `extra_actions` (ej. 'approve_payment').
 */
function requirePermission(moduleCode, action) {
  return async (req, res, next) => {
    try {
      const { db, tenantId, user } = req;
      if (!db || !tenantId || !user) {
        throw ApiError.unauthorized('No autenticado.');
      }

      const permissions = await getEffectivePermissions(db, tenantId, user.id);
      const modulePerm = permissions[moduleCode];

      const allowed = Boolean(
        modulePerm &&
          (CRUD_ACTIONS.includes(action)
            ? modulePerm[`can_${action}`]
            : modulePerm.extra_actions?.[action] === true)
      );

      if (!allowed) {
        throw ApiError.forbidden(`No tienes permiso de "${action}" sobre "${moduleCode}".`);
      }

      req.permissions = permissions;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission, getEffectivePermissions, invalidatePermissionsCache };
