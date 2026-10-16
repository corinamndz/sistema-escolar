const { ApiError } = require('../../utils/ApiError');
const { encrypt, decrypt } = require('../../services/crypto/secretBox');
const mailer = require('../../services/email/mailer');
const google = require('../../services/google/googleOAuth');

/**
 * Configuración del correo del colegio (Configuración → Correo): servidor
 * SMTP, remitente y contraseña de aplicación (cifrada, nunca se devuelve).
 * Incluye el "Enviar correo de prueba", que verifica la conexión y el inicio
 * de sesión y envía un correo real antes de activar los envíos automáticos.
 */

const isGmail = (host) => /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(String(host || '').trim());

const readable = (enc) => {
  if (!enc) return true;
  try {
    decrypt(enc);
    return true;
  } catch {
    return false;
  }
};

/** Vista para la interfaz: todo menos contraseñas y tokens. */
async function getMailSettings(trx, tenantId) {
  const row = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first();
  const fallback = Boolean(process.env.SMTP_HOST);
  // «Conectar con Google» disponible si el servidor tiene la app de Google Cloud configurada.
  const googleInfo = { available: google.isConfigured(), redirect_uri: google.config().redirectUri };
  if (!row) return { configured: false, provider: null, server_fallback: fallback, google: googleInfo };
  const passwordReadable = readable(row.password_enc);
  if (row.provider === 'google') {
    return {
      configured: true,
      provider: 'google',
      server_fallback: fallback,
      google: {
        ...googleInfo,
        connected: true,
        email: row.username,
        connected_at: row.oauth_connected_at,
        error: row.oauth_error || (readable(row.oauth_refresh_token_enc) ? null : 'No se pudo leer la autorización de Google (cambió la clave de cifrado): vuelve a conectar la cuenta.'),
      },
      username: row.username,
      from_name: row.from_name,
      enabled: row.enabled,
      last_test: row.last_test_at ? { at: row.last_test_at, ok: row.last_test_ok, error: row.last_test_error } : null,
      updated_at: row.updated_at,
    };
  }
  return {
    configured: true,
    provider: 'smtp',
    google: googleInfo,
    server_fallback: fallback,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    from_name: row.from_name,
    has_password: Boolean(row.password_enc),
    password_readable: passwordReadable,
    enabled: row.enabled,
    is_gmail: isGmail(row.host),
    last_test: row.last_test_at ? { at: row.last_test_at, ok: row.last_test_ok, error: row.last_test_error } : null,
    updated_at: row.updated_at,
  };
}

/**
 * Guarda la configuración. `password` vacío o ausente conserva la guardada.
 * Activar los envíos exige tener contraseña.
 */
async function saveMailSettings(trx, tenantId, userId, data) {
  let current = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first();
  if (current?.provider === 'google') {
    // Se cambia de la cuenta de Google a SMTP: se revoca la autorización de Google.
    try {
      await google.revokeToken(decrypt(current.oauth_refresh_token_enc));
    } catch {
      // ya no se podía leer
    }
    current = null;
  }
  const password = data.password ? mailer.normalizePassword(data.password) : null;
  if (!password && !current?.password_enc) {
    throw ApiError.badRequest('Escribe la contraseña de aplicación del correo.', [{ path: 'password', message: 'Requerida.' }]);
  }
  if (password && isGmail(data.host) && password.length !== 16) {
    throw ApiError.badRequest('La contraseña de aplicación de Google tiene 16 letras (se ve como "abcd efgh ijkl mnop"). No uses la contraseña normal de la cuenta.', [
      { path: 'password', message: 'Debe tener 16 letras.' },
    ]);
  }
  const row = {
    tenant_id: tenantId,
    provider: 'smtp',
    oauth_refresh_token_enc: null,
    oauth_access_token_enc: null,
    oauth_token_expires_at: null,
    oauth_scope: null,
    oauth_connected_at: null,
    oauth_error: null,
    host: data.host.trim().toLowerCase(),
    port: data.port,
    secure: data.secure ?? data.port === 465,
    username: data.username.trim(),
    from_name: data.fromName?.trim() || null,
    enabled: Boolean(data.enabled),
    updated_by: userId,
    updated_at: trx.fn.now(),
    ...(password ? { password_enc: encrypt(password) } : {}),
  };
  // Si cambian el servidor o la cuenta, el último resultado de prueba ya no vale.
  const changed = !current || current.host !== row.host || current.port !== row.port || current.username !== row.username || Boolean(password);
  if (changed) Object.assign(row, { last_test_at: null, last_test_ok: null, last_test_error: null });
  await trx('tenant_mail_settings').insert(row).onConflict('tenant_id').merge();
  return getMailSettings(trx, tenantId);
}

/** Quita la configuración del colegio (vuelve al SMTP global del servidor, si existe). */
async function deleteMailSettings(trx, tenantId) {
  const current = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first();
  if (current?.provider === 'google') {
    try {
      await google.revokeToken(decrypt(current.oauth_refresh_token_enc));
    } catch {
      // ya no se podía leer
    }
  }
  const deleted = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).delete();
  return { deleted: deleted > 0, ...(await getMailSettings(trx, tenantId)) };
}

/** Mensaje claro para los errores habituales (sobre todo de Gmail). */
function friendlyError(err, cfg) {
  const msg = String(err?.response || err?.message || err);
  if (err?.code === 'EAUTH' || /535|534|Username and Password not accepted|Invalid login|BadCredentials/i.test(msg)) {
    return isGmail(cfg.host)
      ? 'Gmail rechazó el usuario o la contraseña. Usa una CONTRASEÑA DE APLICACIÓN (no la contraseña normal): requiere tener activada la verificación en 2 pasos en la cuenta de Google.'
      : 'El servidor rechazó el usuario o la contraseña.';
  }
  if (/wrong version number|ssl3_get_record|EPROTO/i.test(msg)) {
    return `El puerto ${cfg.port} no coincide con el tipo de seguridad: usa 465 con SSL/TLS, o 587 con STARTTLS.`;
  }
  if (err?.code === 'EDNS' || /ENOTFOUND|getaddrinfo/i.test(msg)) return `No se encontró el servidor "${cfg.host}": revisa el nombre.`;
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(err?.code) || /timeout|ECONNREFUSED/i.test(msg)) {
    return `No se pudo conectar a ${cfg.host}:${cfg.port}. Revisa el servidor y el puerto, o si la red bloquea el envío de correo.`;
  }
  if (/550|553|554/.test(msg)) return `El servidor rechazó el envío: ${msg.slice(0, 200)}`;
  return `No se pudo enviar: ${msg.slice(0, 300)}`;
}

/**
 * "Enviar correo de prueba": usa los datos del formulario (aunque no estén
 * guardados; la contraseña vacía usa la guardada), verifica la conexión y
 * envía un correo a `to`. Si se probó la configuración guardada, deja
 * constancia del resultado. Devuelve { ok, message, error? }.
 */
async function testMailSettings(trx, tenantId, { to, host, port, secure, username, password, fromName }) {
  const saved = await trx('tenant_mail_settings').where({ tenant_id: tenantId }).first();
  let pass = password ? mailer.normalizePassword(password) : null;
  if (!pass && saved?.provider === 'smtp' && saved?.password_enc) {
    try {
      pass = decrypt(saved.password_enc);
    } catch {
      throw ApiError.badRequest('No se pudo leer la contraseña guardada: vuelve a escribirla.', [{ path: 'password', message: 'Vuelve a escribirla.' }]);
    }
  }
  if (!pass) throw ApiError.badRequest('Escribe la contraseña de aplicación para probar.', [{ path: 'password', message: 'Requerida.' }]);

  const cfg = { host: host.trim().toLowerCase(), port, secure: secure ?? port === 465, username: username.trim(), password: pass };
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const transport = mailer.createTransport(mailer.transportOptions(cfg));
  let result;
  try {
    await transport.verify();
    await transport.sendMail({
      from: mailer.formatFrom(fromName || tenant?.name, cfg.username),
      to,
      subject: `Correo de prueba · ${tenant?.name || 'Sistema escolar'}`,
      text: `¡Funciona! Este es un correo de prueba enviado desde la configuración de ${tenant?.name || 'tu colegio'}.\nServidor: ${cfg.host}:${cfg.port}\nRemitente: ${cfg.username}`,
      html: `<p><strong>¡Funciona!</strong> Este es un correo de prueba enviado desde la configuración de ${mailer.escapeHtml(tenant?.name || 'tu colegio')}.</p>
             <p style="color:#64748b">Servidor: ${mailer.escapeHtml(cfg.host)}:${cfg.port} · Remitente: ${mailer.escapeHtml(cfg.username)}</p>`,
    });
    result = { ok: true, message: `Correo de prueba enviado a ${to}. Revisa la bandeja de entrada (y la carpeta de spam).` };
  } catch (err) {
    result = { ok: false, error: friendlyError(err, cfg) };
  } finally {
    transport.close();
  }

  const sameAsSaved = saved && saved.provider === 'smtp' && saved.host === cfg.host && saved.port === cfg.port && saved.username === cfg.username && !password;
  if (sameAsSaved) {
    await trx('tenant_mail_settings')
      .where({ tenant_id: tenantId })
      .update({ last_test_at: trx.fn.now(), last_test_ok: result.ok, last_test_error: result.ok ? null : result.error.slice(0, 500) });
  }
  return { ...result, recorded: Boolean(sameAsSaved) };
}

module.exports = { getMailSettings, saveMailSettings, deleteMailSettings, testMailSettings, friendlyError };
