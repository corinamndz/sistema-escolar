const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');
const { withTenantTransaction } = require('../../config/database');
const { encrypt, decrypt } = require('../../services/crypto/secretBox');
const google = require('../../services/google/googleOAuth');
const mailer = require('../../services/email/mailer');

/**
 * «Conectar con Google»: el colegio autoriza a la plataforma a ENVIAR correos
 * desde su cuenta de Gmail (permiso gmail.send), sin servidor ni contraseñas.
 *
 *   1. POST /tenant/mail-settings/google/connect → URL de consentimiento de
 *      Google con `state` (de un solo uso, 10 min) y PKCE.
 *   2. Google redirige a GET /api/integrations/google/callback?code&state:
 *      se valida el state, se cambia el code por los tokens, se guardan
 *      CIFRADOS y se vuelve a Configuración → Correo.
 *   3. Los envíos usan la Gmail API y renuevan el token solos (mailer.js).
 */

const STATE_TTL_MIN = 10;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertConfigured() {
  if (!google.isConfigured()) {
    throw ApiError.unprocessable(
      'La conexión con Google no está configurada en el servidor: falta crear la app en Google Cloud y definir GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.'
    );
  }
}

/** Paso 1: URL a la que el navegador debe ir para autorizar. */
async function startGoogleConnect(trx, tenantId, userId, { loginHint } = {}) {
  assertConfigured();
  // El state lleva el colegio (para abrir su transacción al volver) y un secreto aleatorio.
  const state = `${tenantId}.${crypto.randomBytes(32).toString('base64url')}`;
  const { verifier, challenge } = google.pkcePair();
  await trx('oauth_states').where({ tenant_id: tenantId }).andWhere('expires_at', '<', trx.fn.now()).delete();
  await trx('oauth_states').insert({
    state_hash: sha256(state),
    tenant_id: tenantId,
    user_id: userId,
    provider: 'google',
    code_verifier_enc: encrypt(verifier),
    expires_at: trx.raw(`now() + interval '${STATE_TTL_MIN} minutes'`),
  });
  return { url: google.buildAuthUrl({ state, codeChallenge: challenge, loginHint }) };
}

/** Vuelta a Configuración → Correo con el resultado (?google=connected | error&reason=…). */
const backToSettings = (params) => `${frontendUrl()}/tenant/settings?${new URLSearchParams({ tab: 'correo', ...params })}`;

/**
 * Paso 2 (sin sesión: es el navegador volviendo de Google). Devuelve la URL a
 * la que redirigir. Nunca lanza: cualquier problema vuelve con el motivo.
 */
async function handleGoogleCallback({ code, state, error }) {
  const tenantId = String(state || '').split('.')[0];
  if (!state || !UUID.test(tenantId)) return backToSettings({ google: 'error', reason: 'invalid_state' });
  try {
    return await withTenantTransaction(tenantId, async (trx) => {
      // De un solo uso: se borra al leerlo (también si después algo falla).
      const [pending] = await trx('oauth_states').where({ tenant_id: tenantId, state_hash: sha256(state) }).delete().returning('*');
      if (!pending) return backToSettings({ google: 'error', reason: 'invalid_state' });
      if (new Date(pending.expires_at) < new Date()) return backToSettings({ google: 'error', reason: 'expired' });
      if (error) return backToSettings({ google: 'error', reason: error === 'access_denied' ? 'cancelled' : 'google_error' });
      if (!code) return backToSettings({ google: 'error', reason: 'google_error' });

      const tokens = await google.exchangeCode({ code, codeVerifier: decrypt(pending.code_verifier_enc) });
      const scopes = String(tokens.scope || '').split(/\s+/);
      if (!scopes.includes(google.GMAIL_SEND)) {
        // Desmarcó "Enviar correo electrónico en tu nombre" en la pantalla de Google.
        await google.revokeToken(tokens.refresh_token || tokens.access_token);
        return backToSettings({ google: 'error', reason: 'missing_scope' });
      }
      if (!tokens.refresh_token) return backToSettings({ google: 'error', reason: 'no_refresh_token' });
      const email = google.emailFromIdToken(tokens.id_token);
      if (!email) return backToSettings({ google: 'error', reason: 'no_email' });

      const current = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first();
      if (current?.provider === 'google' && current.oauth_refresh_token_enc) {
        // Reconexión (o cambio de cuenta): se revoca la autorización anterior.
        try {
          await google.revokeToken(decrypt(current.oauth_refresh_token_enc));
        } catch {
          // ya no se podía leer: no hay nada que revocar
        }
      }
      const tenant = await trx('tenants').where({ id: tenantId }).first('name');
      await trx('tenant_mail_settings')
        .insert({
          tenant_id: tenantId,
          provider: 'google',
          host: null,
          port: null,
          secure: true,
          username: email,
          password_enc: null,
          from_name: current?.from_name || tenant?.name || null,
          // Primera conexión: envíos activos. Reconexión: se respeta lo que había.
          enabled: current ? current.enabled : true,
          oauth_refresh_token_enc: encrypt(tokens.refresh_token),
          oauth_access_token_enc: tokens.access_token ? encrypt(tokens.access_token) : null,
          oauth_token_expires_at: new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000),
          oauth_scope: tokens.scope,
          oauth_connected_at: trx.fn.now(),
          oauth_error: null,
          last_test_at: null,
          last_test_ok: null,
          last_test_error: null,
          updated_by: pending.user_id,
          updated_at: trx.fn.now(),
        })
        .onConflict('tenant_id')
        .merge();
      return backToSettings({ google: 'connected' });
    });
  } catch (err) {
    console.error('[google] Falló la conexión de la cuenta:', err.message);
    return backToSettings({ google: 'error', reason: err.code === 'GOOGLE_UNREACHABLE' ? 'unreachable' : 'exchange_failed' });
  }
}

/** Desconecta la cuenta: revoca la autorización en Google y quita la configuración. */
async function disconnectGoogle(trx, tenantId) {
  const row = await trx('tenant_mail_settings').where({ tenant_id: tenantId, provider: 'google' }).first();
  if (!row) throw ApiError.notFound('No hay una cuenta de Google conectada.');
  try {
    await google.revokeToken(decrypt(row.oauth_refresh_token_enc));
  } catch {
    // no se pudo leer o Google ya no la reconoce: igual se quita
  }
  await trx('tenant_mail_settings').where({ tenant_id: tenantId }).delete();
  return { disconnected: true, email: row.username };
}

/** Ajustes de la cuenta conectada: nombre del remitente y envíos activos. */
async function updateGoogleSettings(trx, tenantId, userId, { fromName, enabled }) {
  const row = await trx('tenant_mail_settings').where({ tenant_id: tenantId, provider: 'google' }).first();
  if (!row) throw ApiError.notFound('No hay una cuenta de Google conectada.');
  const patch = { updated_by: userId };
  if (fromName !== undefined) patch.from_name = fromName?.trim() || null;
  if (enabled !== undefined) patch.enabled = enabled;
  // No se toca updated_at: el transporte (y su token en memoria) sigue valiendo.
  await trx('tenant_mail_settings').where({ tenant_id: tenantId }).update(patch);
}

/** «Probar envío» con la cuenta conectada (aunque los envíos estén desactivados). */
async function testGoogle(trx, tenantId, { to }) {
  const row = await trx('tenant_mail_settings').where({ tenant_id: tenantId, provider: 'google' }).first();
  if (!row) throw ApiError.notFound('No hay una cuenta de Google conectada.');
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  let result;
  try {
    await mailer.sendMail({
      trx,
      tenantId,
      ignoreDisabled: true,
      to,
      subject: `Correo de prueba · ${tenant?.name || 'Sistema escolar'}`,
      text: `¡Funciona! Este es un correo de prueba enviado con la cuenta de Google conectada (${row.username}).`,
      html: `<p><strong>¡Funciona!</strong> Este es un correo de prueba enviado con la cuenta de Google conectada (${mailer.escapeHtml(row.username)}).</p>`,
    });
    result = { ok: true, message: `Correo de prueba enviado a ${to} desde ${row.username}. Revisa la bandeja de entrada (y la carpeta de spam).` };
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  await trx('tenant_mail_settings')
    .where({ tenant_id: tenantId })
    .update({ last_test_at: trx.fn.now(), last_test_ok: result.ok, last_test_error: result.ok ? null : String(result.error).slice(0, 500) });
  return { ...result, recorded: true };
}

module.exports = { startGoogleConnect, handleGoogleCallback, disconnectGoogle, updateGoogleSettings, testGoogle };
