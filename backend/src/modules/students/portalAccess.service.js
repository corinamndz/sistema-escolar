const { ApiError } = require('../../utils/ApiError');
const {
  generateTemporaryPassword,
  normalizeEmail,
  assertUsernameAvailable: assertAvailable,
  hashOrGenerate,
  deactivateUser,
} = require('../auth/userAccount.service');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');

/**
 * Usuario de acceso al portal para representantes.
 *
 * - El login usa el correo como `username`, siempre en minúsculas
 *   (auth.service normaliza a minúsculas cualquier usuario con "@").
 * - La unicidad es por colegio: el mismo correo puede existir en otro colegio.
 * - Se asigna el rol de sistema "Representante" del colegio.
 * - Si no se envía contraseña, se genera una temporal que se devuelve UNA sola
 *   vez en la respuesta (nunca se guarda en claro).
 */

const GUARDIAN_ROLE_NAME = 'Representante';

// Validación de correo único a nivel de formulario del representante (campo "portal.email").
const assertUsernameAvailable = (trx, tenantId, username, exceptUserId = null) =>
  assertAvailable(trx, tenantId, username, { exceptUserId, fieldPath: 'portal.email' });

async function getGuardianRoleId(trx, tenantId) {
  const role = await trx('roles').where('tenant_id', tenantId).whereRaw('lower(name) = ?', [GUARDIAN_ROLE_NAME.toLowerCase()]).first();
  if (!role) {
    throw ApiError.unprocessable(
      `No existe el rol "${GUARDIAN_ROLE_NAME}" en este colegio. Créalo en Roles y permisos antes de dar acceso al portal.`
    );
  }
  return role.id;
}

/** Datos del acceso al portal de un representante (null si no tiene). */
async function getPortalAccess(trx, tenantId, userId) {
  if (!userId) return null;
  const user = await trx('users')
    .where({ id: userId, tenant_id: tenantId })
    .select('id', 'username', 'status', 'last_login_at', 'created_at')
    .first();
  return user || null;
}

/**
 * Aplica los cambios de acceso al portal de un representante.
 *
 * `portal` (todo opcional):
 *   { enabled: true, email, password? }   → crea el usuario si no tiene
 *   { email }                              → cambia el correo de acceso
 *   { resetPassword: true, password? }     → nueva contraseña (o temporal generada)
 *   { status: 'active' | 'inactive' }      → activa / desactiva el acceso
 *
 * Devuelve `{ access, temporaryPassword }`; `temporaryPassword` solo viene
 * cuando el sistema generó la contraseña.
 */
async function applyPortalAccess(trx, tenantId, guardian, portal) {
  if (!portal) return { access: await getPortalAccess(trx, tenantId, guardian.user_id), temporaryPassword: null };

  const fullName = `${guardian.first_name} ${guardian.last_name}`;
  let temporaryPassword = null;
  const hashFor = async (password) => {
    const result = await hashOrGenerate(password);
    temporaryPassword = result.temporaryPassword;
    return result.hash;
  };

  // ---- Crear ----
  if (!guardian.user_id) {
    if (!portal.enabled) return { access: null, temporaryPassword: null };
    if (!portal.email) {
      throw ApiError.badRequest('Indica el correo de acceso al portal.', [{ path: 'portal.email', message: 'Requerido.' }]);
    }
    const username = normalizeEmail(portal.email);
    await assertUsernameAvailable(trx, tenantId, username);
    const roleId = await getGuardianRoleId(trx, tenantId);

    const [user] = await trx('users')
      .insert({
        tenant_id: tenantId,
        username,
        password_hash: await hashFor(portal.password),
        full_name: fullName,
        status: 'active',
      })
      .returning('id');
    await trx('user_roles').insert({ user_id: user.id, role_id: roleId });
    await trx('guardians').where({ id: guardian.id }).update({ user_id: user.id });

    return { access: await getPortalAccess(trx, tenantId, user.id), temporaryPassword };
  }

  // ---- Actualizar el existente ----
  const current = await getPortalAccess(trx, tenantId, guardian.user_id);
  if (!current) throw ApiError.notFound('El usuario del portal vinculado ya no existe.');

  const payload = { full_name: fullName };
  if (portal.email && normalizeEmail(portal.email) !== current.username) {
    const username = normalizeEmail(portal.email);
    await assertUsernameAvailable(trx, tenantId, username, current.id);
    payload.username = username;
  }
  if (portal.resetPassword || portal.password) {
    payload.password_hash = await hashFor(portal.password);
  }
  if (portal.status && portal.status !== current.status) {
    payload.status = portal.status;
  }

  await trx('users').where({ id: current.id }).update({ ...payload, updated_at: trx.fn.now() });
  if (payload.status || payload.password_hash) invalidatePermissionsCache(tenantId, current.id);

  return { access: await getPortalAccess(trx, tenantId, current.id), temporaryPassword };
}

/** Al eliminar al representante, su usuario queda inactivo (se conserva por auditoría y pagos históricos). */
const deactivatePortalUser = deactivateUser;

module.exports = { applyPortalAccess, getPortalAccess, deactivatePortalUser, generateTemporaryPassword };
