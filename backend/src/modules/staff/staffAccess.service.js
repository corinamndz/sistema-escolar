const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');
const { normalizeEmail, assertUsernameAvailable, hashOrGenerate, deactivateUser } = require('../auth/userAccount.service');

/**
 * Usuario de acceso al sistema de un miembro del personal, gestionado como
 * una acción del perfil (no solo al crear al empleado).
 *
 * Seguridad:
 *  - Asignar roles es otorgar permisos: las rutas exigen `staff.update` Y
 *    `roles.update` (ver staff.routes.js), para que quien solo edita personal
 *    no pueda crearse un usuario Administrador.
 *  - Nadie puede desactivar su propia cuenta ni cambiar sus propios roles
 *    desde aquí (evita quedarse fuera por accidente).
 *  - El rol "Representante" es del portal de padres: no se asigna al personal.
 */

const PORTAL_ROLE_NAME = 'representante';

async function getStaff(trx, tenantId, staffId) {
  const staff = await trx('staff').where({ id: staffId, tenant_id: tenantId }).first();
  if (!staff) throw ApiError.notFound('Personal no encontrado.');
  return staff;
}

/** Cuenta vinculada (sin hash) con sus roles, o null. */
async function getAccount(trx, tenantId, userId) {
  if (!userId) return null;
  const user = await trx('users')
    .where({ id: userId, tenant_id: tenantId })
    .select('id', 'username', 'status', 'last_login_at', 'created_at')
    .first();
  if (!user) return null;
  const roles = await trx('roles as r')
    .join('user_roles as ur', 'ur.role_id', 'r.id')
    .where('ur.user_id', userId)
    .select('r.id', 'r.name')
    .orderBy('r.name');
  return { ...user, roles };
}

/** Valida que los roles existan en el colegio y no sean el rol del portal de padres. */
async function assertRoles(trx, tenantId, roleIds) {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) {
    throw ApiError.badRequest('Asigna al menos un rol.', [{ path: 'roleIds', message: 'Selecciona al menos un rol.' }]);
  }
  const roles = await trx('roles').where('tenant_id', tenantId).whereIn('id', unique);
  if (roles.length !== unique.length) throw ApiError.badRequest('Uno de los roles seleccionados no existe.');
  if (roles.some((r) => r.name.trim().toLowerCase() === PORTAL_ROLE_NAME)) {
    throw ApiError.unprocessable('El rol "Representante" es del portal de padres; no se asigna al personal.', [
      { path: 'roleIds', message: 'Rol no permitido para personal.' },
    ]);
  }
  return unique;
}

async function getStaffAccess(trx, tenantId, staffId) {
  const staff = await getStaff(trx, tenantId, staffId);
  return { access: await getAccount(trx, tenantId, staff.user_id) };
}

/** Crea el usuario del empleado: { email, password?, roleIds }. */
async function createStaffAccess(trx, tenantId, staffId, { email, password, roleIds }) {
  const staff = await getStaff(trx, tenantId, staffId);
  if (staff.user_id) throw ApiError.conflict('Este empleado ya tiene un usuario de acceso.');
  if (staff.status !== 'active') {
    throw ApiError.unprocessable('El empleado está inactivo. Actívalo antes de darle acceso al sistema.');
  }

  const username = normalizeEmail(email);
  await assertUsernameAvailable(trx, tenantId, username);
  const validRoles = await assertRoles(trx, tenantId, roleIds);
  const { hash, temporaryPassword } = await hashOrGenerate(password);

  const [user] = await trx('users')
    .insert({
      tenant_id: tenantId,
      username,
      password_hash: hash,
      full_name: `${staff.first_name} ${staff.last_name}`,
      status: 'active',
    })
    .returning('id');
  await trx('user_roles').insert(validRoles.map((roleId) => ({ user_id: user.id, role_id: roleId })));
  await trx('staff').where({ id: staffId }).update({ user_id: user.id });

  return { access: await getAccount(trx, tenantId, user.id), temporaryPassword };
}

/**
 * Gestiona el usuario existente: { email?, resetPassword?, password?, status?, roleIds? }.
 * `actorUserId` = quien hace el cambio (para impedir que se bloquee a sí mismo).
 */
async function updateStaffAccess(trx, tenantId, staffId, changes, actorUserId) {
  const staff = await getStaff(trx, tenantId, staffId);
  const account = await getAccount(trx, tenantId, staff.user_id);
  if (!account) throw ApiError.notFound('Este empleado no tiene usuario de acceso.');

  const isSelf = account.id === actorUserId;
  const payload = { full_name: `${staff.first_name} ${staff.last_name}` };
  let temporaryPassword = null;

  if (changes.email && normalizeEmail(changes.email) !== account.username) {
    payload.username = normalizeEmail(changes.email);
    await assertUsernameAvailable(trx, tenantId, payload.username, { exceptUserId: account.id });
  }
  if (changes.resetPassword || changes.password) {
    const result = await hashOrGenerate(changes.password);
    payload.password_hash = result.hash;
    temporaryPassword = result.temporaryPassword;
  }
  if (changes.status && changes.status !== account.status) {
    if (isSelf && changes.status === 'inactive') {
      throw ApiError.unprocessable('No puedes desactivar tu propia cuenta.');
    }
    if (changes.status === 'active' && staff.status !== 'active') {
      throw ApiError.unprocessable('El empleado está inactivo. Actívalo antes de reactivar su acceso.');
    }
    payload.status = changes.status;
  }

  let rolesChanged = false;
  if (changes.roleIds) {
    const next = await assertRoles(trx, tenantId, changes.roleIds);
    const current = account.roles.map((r) => r.id);
    rolesChanged = next.length !== current.length || next.some((id) => !current.includes(id));
    if (rolesChanged && isSelf) {
      throw ApiError.unprocessable('No puedes cambiar tus propios roles. Pídele a otro administrador que lo haga.');
    }
    if (rolesChanged) {
      await trx('user_roles').where({ user_id: account.id }).delete();
      await trx('user_roles').insert(next.map((roleId) => ({ user_id: account.id, role_id: roleId })));
    }
  }

  await trx('users').where({ id: account.id }).update({ ...payload, updated_at: trx.fn.now() });
  // Los permisos efectivos se cachean por usuario: se invalidan si cambió algo que los afecta.
  if (rolesChanged || payload.status || payload.password_hash) invalidatePermissionsCache(tenantId, account.id);

  return { access: await getAccount(trx, tenantId, account.id), temporaryPassword };
}

/** Cuando el empleado se desactiva o se elimina, su usuario deja de poder entrar. */
async function deactivateStaffUser(trx, tenantId, staff) {
  if (staff?.user_id) await deactivateUser(trx, tenantId, staff.user_id);
}

module.exports = { getStaffAccess, createStaffAccess, updateStaffAccess, deactivateStaffUser };
