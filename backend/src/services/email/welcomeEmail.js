const mailer = require('./mailer');
const { escapeHtml } = mailer;
const mailLog = require('../../modules/notifications/mailLog.service');

const { tenantAppUrl } = require('../../utils/frontendUrl');

/** Login del colegio: {FRONTEND_URL}/<slug>/login */
async function loginUrl(trx, tenantId) {
  const tenant = await trx('tenants').where({ id: tenantId }).first('slug');
  return tenantAppUrl(tenant?.slug, '/login');
}

/**
 * Envía el correo de bienvenida con credenciales temporales al usuario
 * recién activado. Los errores se silencian: el correo es un plus y no
 * debe bloquear la operación principal.
 */
async function sendWelcomeEmail(trx, tenantId, { to, schoolName, fullName, username, temporaryPassword }) {
  if (!to) return;
  try {
    const url = await loginUrl(trx, tenantId);
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">${escapeHtml(schoolName)}</p>
    <h2 style="margin:0 0 12px;font-size:20px">Bienvenido/a, ${escapeHtml(fullName)}</h2>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5">Tu acceso ha sido activado. Estas son tus credenciales de inicio de sesión:</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px">
      <p style="margin:0 0 8px;font-size:14px"><strong>Usuario:</strong> ${escapeHtml(username)}</p>
      <p style="margin:0;font-size:14px"><strong>Contraseña temporal:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:13px">${escapeHtml(temporaryPassword)}</code></p>
    </div>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b">Por seguridad, deberás cambiar tu contraseña al iniciar sesión por primera vez.</p>
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Iniciar sesión</a>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Recibes este correo de ${escapeHtml(schoolName)}. Si no esperabas este mensaje, puedes ignorarlo.</p>
  </div></body></html>`;

    const text = [
      `Bienvenido/a, ${fullName}`,
      '',
      'Tu acceso ha sido activado.',
      '',
      `Usuario: ${username}`,
      `Contraseña temporal: ${temporaryPassword}`,
      '',
      'Deberás cambiar tu contraseña al iniciar sesión por primera vez.',
      '',
      `Iniciar sesión: ${url}`,
      '',
      `— ${schoolName}`,
    ].join('\n');

    const subject = `Acceso activado — ${schoolName}`;
    try {
      await mailer.sendMail({ trx, tenantId, to, subject, html, text });
      await mailLog.record(trx, tenantId, { kind: 'credentials', to, toName: fullName, subject });
    } catch (err) {
      await mailLog.record(trx, tenantId, { kind: 'credentials', to, toName: fullName, subject, error: err.message });
    }
  } catch {
    // Error silenciado: el correo de bienvenida es un plus, no un requisito.
  }
}

module.exports = { sendWelcomeEmail };
