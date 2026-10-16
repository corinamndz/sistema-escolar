const crypto = require('crypto');

/**
 * Cifrado de secretos guardados en la base (p. ej. la contraseña SMTP del
 * colegio) con AES-256-GCM: confidencialidad + integridad (si alguien altera
 * el valor cifrado, no se descifra).
 *
 * Clave: SETTINGS_ENCRYPTION_KEY (32 bytes en hex o base64; generarla con
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").
 * Si no está, se deriva de JWT_SECRET (HKDF) y se avisa en consola: funciona,
 * pero cambiar JWT_SECRET obligaría a volver a escribir las contraseñas.
 *
 * Formato guardado: "v1:<iv>:<tag>:<cifrado>" (base64).
 */

let cachedKey = null;
let warned = false;

function key() {
  if (cachedKey) return cachedKey;
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY debe tener 32 bytes (64 caracteres hex o base64).');
    cachedKey = buf;
  } else {
    if (!process.env.JWT_SECRET) throw new Error('Falta SETTINGS_ENCRYPTION_KEY (o JWT_SECRET) para cifrar secretos.');
    if (!warned) {
      console.warn('[secretBox] SETTINGS_ENCRYPTION_KEY no está definida: se deriva de JWT_SECRET. Defínela en el .env.');
      warned = true;
    }
    cachedKey = Buffer.from(crypto.hkdfSync('sha256', process.env.JWT_SECRET, 'sistema-escolar', 'settings-encryption-v1', 32));
  }
  return cachedKey;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

/** Devuelve el texto o lanza un error si la clave cambió o el valor fue alterado. */
function decrypt(stored) {
  const [version, iv, tag, enc] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Formato de secreto desconocido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}

/** Solo para pruebas. */
function resetKeyCache() {
  cachedKey = null;
}

module.exports = { encrypt, decrypt, resetKeyCache };
