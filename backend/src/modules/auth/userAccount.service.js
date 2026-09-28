const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');

/**
 * Piezas comunes para crear y gestionar usuarios de acceso desde otros módulos
 * (portal de representantes, acceso del personal):
 *  - el correo es el `username`, en minúsculas; único por colegio;
 *  - contraseñas con bcrypt; si no se indica una, se genera una temporal que se
 *    devuelve UNA sola vez y nunca se guarda en claro.
 */

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

// Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar o copiar a mano.
const ALPHABET = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnpqrstuvwxyz',
  digit: '23456789',
  symbol: '#$%*+-?@',
};

/** Contraseña temporal de 12 caracteres con al menos una mayúscula, minúscula, dígito y símbolo. */
function generateTemporaryPassword(length = 12) {
  const all = Object.values(ALPHABET).join('');
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(ALPHABET.upper), pick(ALPHABET.lower), pick(ALPHABET.digit), pick(ALPHABET.symbol)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates con crypto para que los caracteres obligatorios no queden siempre al inicio.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const normalizeEmail = (email) => email.trim().toLowerCase();

/** `fieldPath` = campo del formulario al que se asocia el error (ej. 'portal.email', 'email'). */
async function assertUsernameAvailable(trx, tenantId, username, { exceptUserId = null, fieldPath = 'email' } = {}) {
  const query = trx('users').where('tenant_id', tenantId).whereRaw('lower(username) = ?', [username]);
  if (exceptUserId) query.whereNot('id', exceptUserId);
  if (await query.first()) {
    throw ApiError.conflict('Ese correo ya está registrado como usuario en este colegio.', [
      { path: fieldPath, message: 'Correo ya registrado.' },
    ]);
  }
}

/**
 * Hashea `password` o, si no viene, genera una temporal.
 * Devuelve `{ hash, temporaryPassword }` (temporaryPassword = null si la eligió el admin).
 */
async function hashOrGenerate(password) {
  const temporaryPassword = password ? null : generateTemporaryPassword();
  const hash = await bcrypt.hash(password || temporaryPassword, SALT_ROUNDS);
  return { hash, temporaryPassword };
}

/** Deja el usuario inactivo (no se borra: se conserva por auditoría). */
async function deactivateUser(trx, tenantId, userId) {
  if (!userId) return;
  await trx('users').where({ id: userId, tenant_id: tenantId }).update({ status: 'inactive', updated_at: trx.fn.now() });
  invalidatePermissionsCache(tenantId, userId);
}

module.exports = {
  SALT_ROUNDS,
  generateTemporaryPassword,
  normalizeEmail,
  assertUsernameAvailable,
  hashOrGenerate,
  deactivateUser,
};
