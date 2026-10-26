const { ApiError } = require('../utils/ApiError');
const cache = require('../utils/cache');

const ADMIN_ROLE = 'Administrador';

/**
 * ¿El usuario tiene el rol de sistema Administrador (Director)? Los roles de
 * sistema no se pueden renombrar (role.service), así que el nombre es fiable.
 * Se cachea con el prefijo de los permisos: invalidatePermissionsCache lo limpia
 * cuando cambian los roles del usuario.
 */
async function isAdmin(db, tenantId, userId) {
  const key = `perm:${tenantId}:${userId}:admin`;
  const cached = cache.get(key);
  if (cached !== undefined && cached !== null) return cached;
  const row = await db('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'ur.user_id': userId, 'r.tenant_id': tenantId, 'r.is_system': true, 'r.name': ADMIN_ROLE })
    .first('r.id');
  const result = Boolean(row);
  cache.set(key, result, { ttlSeconds: 300 });
  return result;
}

/** Solo el Administrador (403 para cualquier otro rol, aunque tenga permisos de módulo). */
async function requireAdmin(req, res, next) {
  try {
    if (!req.db || !req.user) throw ApiError.unauthorized('No autenticado.');
    if (!(await isAdmin(req.db, req.tenantId, req.user.id))) {
      throw ApiError.forbidden('Solo el Administrador puede acceder a la auditoría.');
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { ADMIN_ROLE, isAdmin, requireAdmin };
