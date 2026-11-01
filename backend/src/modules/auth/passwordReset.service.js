const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const { invalidatePermissionsCache } = require('../../middlewares/permission.middleware');
const { logAudit } = require('../../services/audit/audit.service');
const mailer = require('../../services/email/mailer');
const mailLog = require('../notifications/mailLog.service');
const { tenantAppUrl } = require('../../utils/frontendUrl');

const { escapeHtml } = mailer;
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;
/** Vigencia del enlace (minutos). */
const TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30;
/** No se manda más de un correo por minuto a la misma cuenta. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Respuesta ÚNICA de la solicitud, exista o no la cuenta: así el formulario no
 * sirve para averiguar qué correos están registrados en el colegio.
 */
const GENERIC_MESSAGE = 'Si el correo pertenece a una cuenta activa del colegio, te enviamos un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada (y la carpeta de spam).';

/** Token de 256 bits para el enlace; en la base solo se guarda su SHA-256. */
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// ---------------------------------------------------------------------------
// Límite por IP (en memoria): frena el envío masivo de solicitudes.
// Con varias instancias del backend conviene moverlo a Redis o al proxy.
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) {
    throw new ApiError(429, 'Demasiadas solicitudes. Espera unos minutos antes de intentarlo de nuevo.');
  }
}

async function activeTenant(tenantSlug) {
  const slug = String(tenantSlug || '').trim().toLowerCase();
  const tenant = slug ? await db('tenants').where({ slug, status: 'active' }).first() : null;
  if (!tenant) throw ApiError.badRequest('Colegio no encontrado o inactivo.');
  return tenant;
}

/**
 * Cuenta activa a la que pertenece el correo. Los representantes usan su correo
 * como usuario; el personal entra con un usuario y su correo está en su ficha
 * (staff.email). También se acepta el correo de la ficha del representante.
 */
async function findAccountByEmail(trx, tenantId, email) {
  const byUsername = await trx('users').where({ tenant_id: tenantId, username: email }).first();
  if (byUsername) return byUsername;
  const linked = await trx('users as u')
    .leftJoin('staff as s', 's.user_id', 'u.id')
    .leftJoin('guardians as g', 'g.user_id', 'u.id')
    .where('u.tenant_id', tenantId)
    .andWhere((q) => q.whereRaw('lower(s.email) = ?', [email]).orWhereRaw('lower(g.email) = ?', [email]))
    .first('u.*');
  return linked || null;
}

function resetEmail({ schoolName, fullName, url }) {
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">${escapeHtml(schoolName)} · MoDo Educa</p>
    <h2 style="margin:0 0 12px;font-size:20px">Restablece tu contraseña</h2>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5">Hola, ${escapeHtml(fullName)}. Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">El enlace vence en <strong>${TTL_MINUTES} minutos</strong> y sirve una sola vez.</p>
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Crear nueva contraseña</a>
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all">Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(url)}</p>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Si no pediste este cambio, ignora este correo: tu contraseña actual sigue funcionando.</p>
  </div></body></html>`;
  const text = [
    `Hola, ${fullName}.`,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    `Crea una nueva aquí (vence en ${TTL_MINUTES} minutos, sirve una sola vez):`,
    url,
    '',
    'Si no pediste este cambio, ignora este correo.',
    '',
    `— ${schoolName}`,
  ].join('\n');
  return { subject: `Restablece tu contraseña — ${schoolName}`, html, text };
}

/**
 * POST /auth/forgot-password. Siempre responde lo mismo (GENERIC_MESSAGE).
 * Sin correo configurado en el colegio, en desarrollo el enlace se muestra en
 * la consola del backend para poder probar el flujo.
 */
async function requestReset({ tenantSlug, email }, context = {}) {
  checkRateLimit(`${context.ip || 'sin-ip'}|${String(tenantSlug).toLowerCase()}`);
  const tenant = await activeTenant(tenantSlug);
  const normalized = String(email).trim().toLowerCase();

  await withTenantTransaction(tenant.id, async (trx) => {
    const user = await findAccountByEmail(trx, tenant.id, normalized);
    if (!user || user.status !== 'active') return;
    if (user.reset_requested_at && Date.now() - new Date(user.reset_requested_at).getTime() < RESEND_COOLDOWN_MS) return;

    const token = newToken();
    // Un enlace nuevo reemplaza al anterior (el viejo deja de funcionar).
    await trx('users')
      .where({ id: user.id })
      .update({
        reset_token_hash: hashToken(token),
        reset_token_expires: trx.raw(`now() + interval '${TTL_MINUTES} minutes'`),
        reset_requested_at: trx.fn.now(),
      });

    const url = tenantAppUrl(tenant.slug, `/reset-password?token=${encodeURIComponent(token)}`);
    const { subject, html, text } = resetEmail({ schoolName: tenant.name, fullName: user.full_name, url });
    const log = { kind: 'password_reset', to: normalized, toName: user.full_name, refId: user.id, subject };
    try {
      await mailer.sendMail({ trx, tenantId: tenant.id, to: normalized, subject, html, text });
      await mailLog.record(trx, tenant.id, log);
    } catch (err) {
      await mailLog.record(trx, tenant.id, { ...log, error: err.message });
      if (process.env.NODE_ENV !== 'production') console.info(`[recuperación] Correo no enviado (${err.message}). Enlace para ${normalized}: ${url}`);
    }

    await logAudit(trx, {
      tenantId: tenant.id,
      userId: user.id,
      actorName: user.full_name,
      actorUsername: user.username,
      action: 'SOLICITAR_RECUPERACION',
      module: 'auth',
      entity: 'users',
      entityId: user.id,
      summary: 'Solicitó restablecer su contraseña',
      ...context,
    });
  });

  return { message: GENERIC_MESSAGE };
}

/** Consulta del usuario dueño de un token vigente (`.first()` → fila o undefined); encadenable con `.forUpdate()`. */
function userForToken(trx, tenantId, token) {
  return trx('users')
    .where({ tenant_id: tenantId, reset_token_hash: hashToken(token), status: 'active' })
    .andWhere('reset_token_expires', '>', trx.fn.now())
    .first();
}

const INVALID_LINK = 'El enlace no es válido o ya venció. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».';

/** POST /auth/reset-password/verify: ¿el enlace sigue vigente? (antes de mostrar el formulario). */
async function verifyToken({ tenantSlug, token }) {
  const tenant = await activeTenant(tenantSlug);
  const user = await withTenantTransaction(tenant.id, (trx) => userForToken(trx, tenant.id, token));
  if (!user) throw ApiError.badRequest(INVALID_LINK);
  return { valid: true, username: user.username, expiresAt: user.reset_token_expires };
}

/** POST /auth/reset-password: nueva contraseña + enlace de un solo uso. */
async function resetPassword({ tenantSlug, token, newPassword }, context = {}) {
  const tenant = await activeTenant(tenantSlug);
  return withTenantTransaction(tenant.id, async (trx) => {
    // FOR UPDATE: dos envíos simultáneos del mismo enlace no lo usan dos veces.
    const user = await userForToken(trx, tenant.id, token).forUpdate();
    if (!user) throw ApiError.badRequest(INVALID_LINK);

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await trx('users').where({ id: user.id }).update({
      password_hash: passwordHash,
      must_change_password: false,
      reset_token_hash: null,
      reset_token_expires: null,
      updated_at: trx.fn.now(),
    });
    invalidatePermissionsCache(tenant.id, user.id);

    await logAudit(trx, {
      tenantId: tenant.id,
      userId: user.id,
      actorName: user.full_name,
      actorUsername: user.username,
      action: 'RESTABLECER_CONTRASENA',
      module: 'auth',
      entity: 'users',
      entityId: user.id,
      summary: 'Restableció su contraseña con el enlace enviado por correo',
      ...context,
    });
    return { message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión con la nueva.', username: user.username };
  });
}

module.exports = { requestReset, verifyToken, resetPassword, hashToken, GENERIC_MESSAGE };
