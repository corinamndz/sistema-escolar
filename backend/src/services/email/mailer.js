const nodemailer = require('nodemailer');
const { encrypt, decrypt } = require('../crypto/secretBox');
const google = require('../google/googleOAuth');
const { GmailApiTransport } = require('./gmailApiTransport');

/**
 * Envío de correos.
 *
 * Cada colegio configura su correo en Configuración → Correo (tabla
 * tenant_mail_settings, secretos cifrados):
 *   - provider 'google': cuenta de Gmail conectada con «Conectar con Google»
 *     (OAuth2). Se envía por la Gmail API con el permiso gmail.send; el token
 *     de acceso se renueva solo con el de refresco cuando vence.
 *   - provider 'smtp': servidor, puerto y contraseña (Gmail con contraseña de
 *     aplicación o un SMTP corporativo).
 * En cada envío se lee esa configuración (con un transporte en memoria que se
 * renueva si cambia).
 *
 *   - El colegio tiene configuración ACTIVADA → se envía con ella.
 *   - Tiene configuración DESACTIVADA → no se envían correos automáticos.
 *   - No tiene configuración → SMTP global del servidor (SMTP_* del .env),
 *     el comportamiento anterior.
 */

const TIMEOUTS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };
const transports = new Map(); // clave → transporte de nodemailer

class MailDisabledError extends Error {
  constructor(message = 'El envío de correos no está configurado o está desactivado para este colegio.') {
    super(message);
    this.code = 'MAIL_DISABLED';
  }
}

/** Gmail muestra la contraseña de aplicación en grupos ("abcd efgh ijkl mnop"): los espacios sobran. */
const normalizePassword = (password) => String(password ?? '').replace(/\s+/g, '');

/** Opciones de nodemailer para una configuración { host, port, secure, username, password }. */
function transportOptions({ host, port, secure, username, password }) {
  return { host, port: Number(port), secure: Boolean(secure), auth: username ? { user: username, pass: normalizePassword(password) } : undefined, ...TIMEOUTS };
}

function createTransport(options) {
  return nodemailer.createTransport(options);
}

/** "Colegio San José" <colegio@gmail.com> */
function formatFrom(name, email) {
  if (!name) return email;
  return `"${String(name).replace(/["\\\r\n]/g, '')}" <${email}>`;
}

function envConfig() {
  if (!process.env.SMTP_HOST) return null;
  return {
    source: 'env',
    enabled: true,
    key: `env:${process.env.SMTP_HOST}:${process.env.SMTP_PORT}:${process.env.SMTP_USER}`,
    options: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      ...TIMEOUTS,
    },
    from: process.env.SMTP_FROM || 'no-reply@school-saas.local',
  };
}

/**
 * Configuración que se usará para el colegio: { source: 'tenant'|'env',
 * enabled, options, from, key } o null si no hay ninguna.
 */
async function resolveMailConfig(trx, tenantId, { ignoreDisabled = false } = {}) {
  if (trx && tenantId) {
    const { rows } = await trx.raw("SELECT to_regclass('tenant_mail_settings') IS NOT NULL AS ok");
    const row = rows[0].ok ? await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first() : null;
    if (row) {
      if (!row.enabled && !ignoreDisabled) return { source: 'tenant', enabled: false };
      if (row.provider === 'google') return googleConfig(row);
      if (!row.password_enc) throw new MailDisabledError('Falta la contraseña del correo del colegio: regístrala en Configuración → Correo.');
      let password;
      try {
        password = decrypt(row.password_enc);
      } catch {
        throw new MailDisabledError('No se pudo leer la contraseña del correo del colegio (cambió la clave de cifrado): vuelve a escribirla en Configuración → Correo.');
      }
      return {
        source: 'tenant',
        enabled: true,
        key: `tenant:${tenantId}:${new Date(row.updated_at).getTime()}`,
        options: transportOptions({ ...row, password }),
        from: formatFrom(row.from_name, row.username),
      };
    }
  }
  return envConfig();
}

// ---------------------------------------------------------------------------
// Google (OAuth2 + Gmail API)
// ---------------------------------------------------------------------------

/** Guarda en su PROPIA transacción (la del request puede revertirse) y sin cambiar updated_at. */
async function saveOAuthState(tenantId, patch) {
  try {
    // require diferido: database.js se carga después que este módulo en algunos scripts.
    const { withTenantTransaction } = require('../../config/database');
    await withTenantTransaction(tenantId, (t) => t('tenant_mail_settings').where({ tenant_id: tenantId, provider: 'google' }).update(patch));
  } catch (err) {
    console.error('[mail] No se pudo guardar el estado de la cuenta de Google:', err.message);
  }
}

/** Configuración de envío con la cuenta de Google del colegio. */
function googleConfig(row) {
  if (!google.isConfigured()) {
    throw new MailDisabledError('La conexión con Google no está configurada en el servidor (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET).');
  }
  let refreshToken;
  try {
    refreshToken = decrypt(row.oauth_refresh_token_enc);
  } catch {
    throw new MailDisabledError('No se pudo leer la autorización de Google (cambió la clave de cifrado): vuelve a conectar la cuenta en Configuración → Correo.');
  }
  // Token de acceso en memoria (y cifrado en la base): se renueva al vencer.
  const token = { value: null, expiresAt: row.oauth_token_expires_at ? new Date(row.oauth_token_expires_at).getTime() : 0 };
  try {
    if (row.oauth_access_token_enc) token.value = decrypt(row.oauth_access_token_enc);
  } catch {
    token.value = null;
  }
  const tenantId = row.tenant_id;
  const getAccessToken = async ({ force }) => {
    if (!force && token.value && token.expiresAt - 60000 > Date.now()) return token.value;
    try {
      const fresh = await google.refreshAccessToken(refreshToken);
      token.value = fresh.access_token;
      token.expiresAt = Date.now() + (Number(fresh.expires_in) || 3600) * 1000;
      await saveOAuthState(tenantId, { oauth_access_token_enc: encrypt(token.value), oauth_token_expires_at: new Date(token.expiresAt), oauth_error: null });
      return token.value;
    } catch (err) {
      if (err.code === 'GOOGLE_REVOKED') {
        await saveOAuthState(tenantId, { oauth_error: err.message, oauth_access_token_enc: null, oauth_token_expires_at: null });
        transports.delete(googleKey(row));
      }
      throw err;
    }
  };
  return {
    source: 'tenant',
    provider: 'google',
    enabled: true,
    key: googleKey(row),
    create: () => nodemailer.createTransport(new GmailApiTransport({ getAccessToken })),
    from: formatFrom(row.from_name, row.username),
  };
}

const googleKey = (row) => `tenant:${row.tenant_id}:google:${new Date(row.updated_at).getTime()}`;

function transportFor(cfg) {
  if (!transports.has(cfg.key)) {
    // Se descartan los transportes viejos del mismo colegio (configuración cambiada).
    const prefix = cfg.key.split(':').slice(0, 2).join(':');
    for (const k of transports.keys()) if (k.startsWith(prefix)) transports.delete(k);
    transports.set(cfg.key, cfg.create ? cfg.create() : createTransport(cfg.options));
  }
  return transports.get(cfg.key);
}

/**
 * Envía un correo con la configuración del colegio (o la global).
 * @param {object} opts
 * @param {import('knex').Knex} [opts.trx]   transacción del request (para leer la configuración)
 * @param {string} [opts.tenantId]
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 * @param {{filename: string, content: Buffer, contentType?: string}[]} [opts.attachments]
 * @param {boolean} [opts.ignoreDisabled]  envía aunque los envíos automáticos estén desactivados (correo de prueba)
 * Lanza MailDisabledError (code 'MAIL_DISABLED') si el colegio no tiene envíos activos.
 */
async function sendMail({ trx = null, tenantId = null, to, subject, html, text, attachments = [], ignoreDisabled = false }) {
  const cfg = await resolveMailConfig(trx, tenantId, { ignoreDisabled });
  if (!cfg || !cfg.enabled) throw new MailDisabledError();
  return transportFor(cfg).sendMail({ from: cfg.from, to, subject, html, text, attachments });
}

/** Escapa texto para insertarlo en el HTML de un correo. */
const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { sendMail, resolveMailConfig, createTransport, transportOptions, formatFrom, normalizePassword, escapeHtml, MailDisabledError };
