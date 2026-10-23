const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');
const { normalizeEmail, assertUsernameAvailable, hashOrGenerate, deactivateUser } = require('../auth/userAccount.service');
const { sendWelcomeEmail } = require('../../services/email/welcomeEmail');
const { assertMailReady } = require('../../services/email/mailer');

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
const COORDINATOR_ROLE = 'Coordinador';

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
    .select('r.id', 'r.name', 'r.hierarchy_level')
    .orderBy('r.name');
  return { ...user, roles };
}

/**
 * Jerarquía (migración 047): un coordinador restringido (`actor.coordinator`)
 * solo asigna roles de MENOR jerarquía que la suya (Docente); los roles fuera
 * de la jerarquía (personalizados) tampoco, porque pueden dar cualquier permiso.
 */
const assignableBy = (actor, role) => !actor?.coordinator || (role.hierarchy_level !== null && role.hierarchy_level !== undefined && role.hierarchy_level > actor.coordinator.rank);

/** Valida que los roles existan en el colegio, no sean el del portal de padres y el actor pueda asignarlos. */
async function assertRoles(trx, tenantId, roleIds, actor = null) {
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
  const notAllowed = roles.filter((r) => !assignableBy(actor, r));
  if (notAllowed.length) {
    throw ApiError.forbidden(`Como coordinador solo puedes asignar roles de menor jerarquía (Docente). No puedes asignar: ${notAllowed.map((r) => r.name).join(', ')}.`, [
      { path: 'roleIds', message: 'Rol fuera de tu jerarquía.' },
    ]);
  }
  return { ids: unique, roles };
}

/**
 * El rol Coordinador exige su etapa (initial | primary | secondary), que se guarda
 * en la ficha (si no se indica, se usa la de la ficha). Sin ese rol, la ficha
 * queda sin etapa, salvo que sea de tipo "Coordinador" (migración 048): su etapa
 * es parte de la ficha.
 */
async function applyCoordinationLevel(trx, staff, roles, coordinationLevel) {
  const isCoordinator = roles.some((r) => r.name === COORDINATOR_ROLE);
  const level = coordinationLevel || staff.coordination_level || null;
  if (isCoordinator && !level) {
    throw ApiError.badRequest('Indica la etapa que coordina (Inicial, Primaria o Secundaria).', [{ path: 'coordinationLevel', message: 'Requerida para el rol Coordinador.' }]);
  }
  const keep = isCoordinator || staff.staff_type === 'coordinator';
  await trx('staff').where({ id: staff.id }).update({ coordination_level: keep ? level : null });
}

/** Roles que el actor puede asignar (para el formulario de acceso), con su jerarquía. */
async function listAssignableRoles(trx, tenantId, actor = null) {
  const roles = await trx('roles').where({ tenant_id: tenantId }).select('id', 'name', 'is_system', 'hierarchy_level').orderByRaw('hierarchy_level NULLS LAST, name');
  return roles.filter((r) => r.name.trim().toLowerCase() !== PORTAL_ROLE_NAME && assignableBy(actor, r));
}

async function getStaffAccess(trx, tenantId, staffId) {
  const staff = await getStaff(trx, tenantId, staffId);
  return { access: await getAccount(trx, tenantId, staff.user_id) };
}

/**
 * Crea el usuario del empleado: { email, password?, roleIds, coordinationLevel? }.
 * `actor` = { coordinator } si quien lo hace es un coordinador restringido.
 */
async function createStaffAccess(trx, tenantId, staffId, { email, password, roleIds, coordinationLevel }, actor = null) {
  const staff = await getStaff(trx, tenantId, staffId);
  if (staff.user_id) throw ApiError.conflict('Este empleado ya tiene un usuario de acceso.');
  if (staff.status !== 'active') {
    throw ApiError.unprocessable('El empleado está inactivo. Actívalo antes de darle acceso al sistema.');
  }

  const username = normalizeEmail(email);
  await assertUsernameAvailable(trx, tenantId, username);
  const { ids: validRoles, roles } = await assertRoles(trx, tenantId, roleIds, actor);
  await applyCoordinationLevel(trx, staff, roles, coordinationLevel);
  // La contraseña temporal solo llega por correo: sin correo utilizable no se activa.
  if (!password) await assertMailReady(trx, tenantId);
  const { hash, temporaryPassword } = await hashOrGenerate(password);

  const fullName = `${staff.first_name} ${staff.last_name}`;
  const [user] = await trx('users')
    .insert({
      tenant_id: tenantId,
      username,
      password_hash: hash,
      full_name: fullName,
      status: 'active',
      must_change_password: temporaryPassword !== null,
    })
    .returning('id');
  await trx('user_roles').insert(validRoles.map((roleId) => ({ user_id: user.id, role_id: roleId })));
  await trx('staff').where({ id: staffId }).update({ user_id: user.id });

  if (temporaryPassword !== null) {
    const tenant = await trx('tenants').where('id', tenantId).select('name').first();
    await sendWelcomeEmail(trx, tenantId, {
      to: username,
      schoolName: tenant?.name ?? '',
      fullName,
      username,
      temporaryPassword,
      accountId: user.id,
    });
  }

  return { access: await getAccount(trx, tenantId, user.id), temporaryPassword };
}

/**
 * Gestiona el usuario existente: { email?, resetPassword?, password?, status?, roleIds? }.
 * `actorUserId` = quien hace el cambio (para impedir que se bloquee a sí mismo).
 */
async function updateStaffAccess(trx, tenantId, staffId, changes, actorUserId, actor = null) {
  const staff = await getStaff(trx, tenantId, staffId);
  const account = await getAccount(trx, tenantId, staff.user_id);
  if (!account) throw ApiError.notFound('Este empleado no tiene usuario de acceso.');
  // Un coordinador no gestiona cuentas con roles de su nivel o superior (ni personalizados).
  if (actor?.coordinator && account.roles.some((r) => !assignableBy(actor, r))) {
    throw ApiError.forbidden('Esta cuenta tiene un rol de igual o mayor jerarquía que la tuya: solo el Director puede gestionarla.');
  }

  const isSelf = account.id === actorUserId;
  const payload = { full_name: `${staff.first_name} ${staff.last_name}` };
  let temporaryPassword = null;

  if (changes.email && normalizeEmail(changes.email) !== account.username) {
    payload.username = normalizeEmail(changes.email);
    await assertUsernameAvailable(trx, tenantId, payload.username, { exceptUserId: account.id });
  }
  if (changes.resetPassword || changes.password) {
    if (!changes.password) await assertMailReady(trx, tenantId);
    const result = await hashOrGenerate(changes.password);
    payload.password_hash = result.hash;
    temporaryPassword = result.temporaryPassword;
    payload.must_change_password = temporaryPassword !== null;
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
    const { ids: next, roles: nextRoles } = await assertRoles(trx, tenantId, changes.roleIds, actor);
    await applyCoordinationLevel(trx, staff, nextRoles, changes.coordinationLevel);
    const current = account.roles.map((r) => r.id);
    rolesChanged = next.length !== current.length || next.some((id) => !current.includes(id));
    if (rolesChanged && isSelf) {
      throw ApiError.unprocessable('No puedes cambiar tus propios roles. Pídele a otro administrador que lo haga.');
    }
    if (rolesChanged) {
      await trx('user_roles').where({ user_id: account.id }).delete();
      await trx('user_roles').insert(next.map((roleId) => ({ user_id: account.id, role_id: roleId })));
    }
  } else if (changes.coordinationLevel !== undefined && (staff.staff_type === 'coordinator' || account.roles.some((r) => r.name === COORDINATOR_ROLE))) {
    // Cambio solo de etapa de un coordinador (sin tocar sus roles).
    if (!changes.coordinationLevel) throw ApiError.badRequest('Indica la etapa que coordina.', [{ path: 'coordinationLevel', message: 'Requerida.' }]);
    await trx('staff').where({ id: staffId }).update({ coordination_level: changes.coordinationLevel });
    rolesChanged = true; // su alcance cambió: se recalculan sus permisos
  }

  await trx('users').where({ id: account.id }).update({ ...payload, updated_at: trx.fn.now() });
  // Los permisos efectivos se cachean por usuario: se invalidan si cambió algo que los afecta.
  if (rolesChanged || payload.status || payload.password_hash) invalidatePermissionsCache(tenantId, account.id);

  if (temporaryPassword !== null) {
    const tenant = await trx('tenants').where('id', tenantId).select('name').first();
    const emailTo = payload.username ?? account.username;
    await sendWelcomeEmail(trx, tenantId, {
      to: emailTo,
      schoolName: tenant?.name ?? '',
      fullName: payload.full_name,
      username: emailTo,
      temporaryPassword,
      accountId: account.id,
    });
  }

  return { access: await getAccount(trx, tenantId, account.id), temporaryPassword };
}

/** Cuando el empleado se desactiva o se elimina, su usuario deja de poder entrar. */
async function deactivateStaffUser(trx, tenantId, staff) {
  if (staff?.user_id) await deactivateUser(trx, tenantId, staff.user_id);
}

module.exports = { getStaffAccess, createStaffAccess, updateStaffAccess, deactivateStaffUser, listAssignableRoles };
