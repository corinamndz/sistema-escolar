const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache, GUARDIAN_ROLE } = require('../../middlewares/permission.middleware');
const { TEACHER_ROLE } = require('../access/teacherScope');

/** Módulos que el rol Docente no puede recibir. */
const TEACHER_FORBIDDEN_MODULES = ['payments', 'promotion'];

async function listRoles(trx, tenantId) {
  return trx('roles').where({ tenant_id: tenantId }).orderBy('name');
}

async function getRoleWithPermissions(trx, tenantId, roleId) {
  const role = await trx('roles').where({ id: roleId, tenant_id: tenantId }).first();
  if (!role) throw ApiError.notFound('Rol no encontrado.');

  const permissions = await trx('role_permissions as rp')
    .join('modules as m', 'm.id', 'rp.module_id')
    .where('rp.tenant_id', tenantId)
    .andWhere('rp.role_id', roleId)
    .select(
      'm.id as module_id',
      'm.code as module_code',
      'm.label as module_label',
      'rp.can_create',
      'rp.can_read',
      'rp.can_update',
      'rp.can_delete',
      'rp.extra_actions'
    )
    .orderBy('m.sort_order');

  return { ...role, permissions };
}

async function createRole(trx, tenantId, { name }) {
  const existing = await trx('roles').where({ tenant_id: tenantId, name }).first();
  if (existing) throw ApiError.conflict('Ya existe un rol con ese nombre.');

  const [role] = await trx('roles').insert({ tenant_id: tenantId, name }).returning('*');
  return role;
}

async function renameRole(trx, tenantId, roleId, { name }) {
  const role = await trx('roles').where({ id: roleId, tenant_id: tenantId }).first();
  if (!role) throw ApiError.notFound('Rol no encontrado.');
  if (role.is_system) throw ApiError.forbidden('No se puede renombrar un rol del sistema.');

  const [updated] = await trx('roles').where({ id: roleId }).update({ name }).returning('*');
  return updated;
}

async function deleteRole(trx, tenantId, roleId) {
  const role = await trx('roles').where({ id: roleId, tenant_id: tenantId }).first();
  if (!role) throw ApiError.notFound('Rol no encontrado.');
  if (role.is_system) throw ApiError.forbidden('No se puede eliminar un rol del sistema.');

  const inUse = await trx('user_roles').where({ role_id: roleId }).first();
  if (inUse) {
    throw ApiError.conflict('No se puede eliminar: hay usuarios con este rol asignado.');
  }

  await trx('roles').where({ id: roleId }).delete();
  invalidatePermissionsCache(tenantId);
}

/**
 * Reemplaza de una vez la matriz de permisos de un rol para los módulos
 * enviados (upsert por módulo). No toca los módulos que no vengan en
 * `permissions`, para permitir actualizaciones parciales desde la UI.
 */
async function setRolePermissions(trx, tenantId, roleId, permissions) {
  const role = await trx('roles').where({ id: roleId, tenant_id: tenantId }).first();
  if (!role) throw ApiError.notFound('Rol no encontrado.');

  for (const perm of permissions) {
    const moduleRow = await trx('modules').where({ code: perm.moduleCode }).first();
    if (!moduleRow) throw ApiError.badRequest(`Módulo desconocido: ${perm.moduleCode}`);
    // El rol Docente nunca accede a pagos ni a cierre y promoción (además el backend los veta con 403).
    const grants = perm.canCreate || perm.canRead || perm.canUpdate || perm.canDelete || Object.values(perm.extraActions || {}).some(Boolean);
    if (role.name === TEACHER_ROLE && TEACHER_FORBIDDEN_MODULES.includes(perm.moduleCode) && grants) {
      throw ApiError.unprocessable(`El rol ${TEACHER_ROLE} no puede tener acceso a "${moduleRow.label}".`, [{ path: perm.moduleCode, message: 'Módulo vedado a docentes.' }]);
    }
    // El representante ve los pagos y notas de SUS hijos desde el portal; un
    // permiso administrativo le abriría los de todo el colegio.
    if (role.name === GUARDIAN_ROLE && perm.moduleCode !== 'dashboard' && grants) {
      throw ApiError.unprocessable(
        `El rol ${GUARDIAN_ROLE} solo usa el portal de padres (pagos y calificaciones de sus hijos): no puede tener acceso a "${moduleRow.label}".`,
        [{ path: perm.moduleCode, message: 'Módulo administrativo.' }]
      );
    }

    const existing = await trx('role_permissions')
      .where({ tenant_id: tenantId, role_id: roleId, module_id: moduleRow.id })
      .first();

    const payload = {
      tenant_id: tenantId,
      role_id: roleId,
      module_id: moduleRow.id,
      can_create: Boolean(perm.canCreate),
      can_read: Boolean(perm.canRead),
      can_update: Boolean(perm.canUpdate),
      can_delete: Boolean(perm.canDelete),
      extra_actions: perm.extraActions || {},
    };

    if (existing) {
      await trx('role_permissions').where({ id: existing.id }).update(payload);
    } else {
      await trx('role_permissions').insert(payload);
    }
  }

  invalidatePermissionsCache(tenantId);
  return getRoleWithPermissions(trx, tenantId, roleId);
}

async function listModules(trx) {
  return trx('modules').orderBy('sort_order');
}

module.exports = {
  listRoles,
  getRoleWithPermissions,
  createRole,
  renameRole,
  deleteRole,
  setRolePermissions,
  listModules,
};
