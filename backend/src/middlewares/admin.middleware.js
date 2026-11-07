const { ApiError } = require('../utils/ApiError');
const cache = require('../utils/cache');

const ADMIN_ROLE = 'Administrador';
/** Rol de sistema Admisiones (migración 083): planillas de inscripción y consulta de alumnos. */
const ADMISSIONS_ROLE = 'Admisiones';

/**
 * ¿El usuario tiene ese rol DE SISTEMA? Los roles de sistema no se pueden
 * renombrar (role.service), así que el nombre es fiable. Se cachea con el
 * prefijo de los permisos: invalidatePermissionsCache lo limpia cuando cambian
 * los roles del usuario.
 */
async function hasSystemRole(db, tenantId, userId, roleName, tag) {
  const key = `perm:${tenantId}:${userId}:${tag}`;
  const cached = cache.get(key);
  if (cached !== undefined && cached !== null) return cached;
  const row = await db('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'ur.user_id': userId, 'r.tenant_id': tenantId, 'r.is_system': true, 'r.name': roleName })
    .first('r.id');
  const result = Boolean(row);
  cache.set(key, result, { ttlSeconds: 300 });
  return result;
}

/** ¿Es Administrador (Director)? */
const isAdmin = (db, tenantId, userId) => hasSystemRole(db, tenantId, userId, ADMIN_ROLE, 'admin');

/** ¿Tiene el rol Admisiones? */
const isAdmissions = (db, tenantId, userId) => hasSystemRole(db, tenantId, userId, ADMISSIONS_ROLE, 'admissions');

/** ¿Gestiona las planillas de inscripción? El Administrador o Admisiones. */
async function canManageAdmissions(db, tenantId, userId) {
  return (await isAdmin(db, tenantId, userId)) || isAdmissions(db, tenantId, userId);
}

/** Solo el Administrador (403 para cualquier otro rol, aunque tenga permisos de módulo). */
async function requireAdmin(req, res, next) {
  try {
    if (!req.db || !req.user) throw ApiError.unauthorized('No autenticado.');
    if (!(await isAdmin(req.db, req.tenantId, req.user.id))) {
      throw ApiError.forbidden('Solo el Administrador del colegio puede acceder a esta sección.');
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Planillas de inscripción (diseño, bandeja, revisión y aprobación): el
 * Administrador o el rol Admisiones. Cualquier otro rol → 403, aunque tenga
 * el permiso de módulo «Planillas de inscripción».
 */
async function requireAdmissions(req, res, next) {
  try {
    if (!req.db || !req.user) throw ApiError.unauthorized('No autenticado.');
    if (!(await canManageAdmissions(req.db, req.tenantId, req.user.id))) {
      throw ApiError.forbidden('Solo el Administrador o el personal de Admisiones pueden acceder a las planillas de inscripción.');
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { ADMIN_ROLE, ADMISSIONS_ROLE, isAdmin, isAdmissions, canManageAdmissions, requireAdmin, requireAdmissions };
