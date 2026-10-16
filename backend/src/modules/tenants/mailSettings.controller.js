const { z } = require('zod');
const service = require('./mailSettings.service');
const googleMail = require('./googleMail.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const host = z
  .string()
  .trim()
  .min(1, 'Escribe el servidor SMTP.')
  .max(255)
  .regex(/^[A-Za-z0-9.-]+$/, 'Servidor inválido (ej.: smtp.gmail.com).');
const port = z.coerce.number().int().min(1, 'Puerto inválido.').max(65535, 'Puerto inválido.');
const email = z.string().trim().email('Correo inválido.').max(255);
const optionalText = (max) => z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(max).optional());

const settingsSchema = z.object({
  host,
  port,
  secure: z.boolean().optional(),
  username: email,
  fromName: optionalText(120),
  password: optionalText(200),
  enabled: z.boolean().default(false),
});

/** GET /tenant/mail-settings — sin la contraseña (solo si hay una guardada). */
const get = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getMailSettings(req.db, req.tenantId));
});

/** PUT /tenant/mail-settings — { host, port, secure?, username, fromName?, password? (vacío = conservar), enabled } */
const save = asyncHandler(async (req, res) => {
  res.status(200).json(await service.saveMailSettings(req.db, req.tenantId, req.user.id, settingsSchema.parse(req.body)));
});

/** DELETE /tenant/mail-settings — vuelve al correo global del servidor. */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteMailSettings(req.db, req.tenantId));
});

/** POST /tenant/mail-settings/test — { to, host, port, secure?, username, password?, fromName? } → { ok, message | error } */
const test = asyncHandler(async (req, res) => {
  const data = settingsSchema.omit({ enabled: true }).extend({ to: email }).parse(req.body);
  res.status(200).json(await service.testMailSettings(req.db, req.tenantId, data));
});

// ---- «Conectar con Google» (OAuth2) ----

/** POST /tenant/mail-settings/google/connect — { loginHint? } → { url } de la pantalla de Google. */
const googleConnect = asyncHandler(async (req, res) => {
  const { loginHint } = z.object({ loginHint: z.string().trim().email().optional().or(z.literal('')) }).parse(req.body || {});
  res.status(200).json(await googleMail.startGoogleConnect(req.db, req.tenantId, req.user.id, { loginHint: loginHint || undefined }));
});

/** GET /api/integrations/google/callback — regreso desde Google (sin sesión): redirige a Configuración. */
const googleCallback = asyncHandler(async (req, res) => {
  const pick = (k) => (typeof req.query[k] === 'string' ? req.query[k] : undefined);
  res.redirect(302, await googleMail.handleGoogleCallback({ code: pick('code'), state: pick('state'), error: pick('error') }));
});

/** PUT /tenant/mail-settings/google — { fromName?, enabled? } */
const googleUpdate = asyncHandler(async (req, res) => {
  const data = z.object({ fromName: z.string().trim().max(120).optional(), enabled: z.boolean().optional() }).parse(req.body || {});
  await googleMail.updateGoogleSettings(req.db, req.tenantId, req.user.id, data);
  res.status(200).json(await service.getMailSettings(req.db, req.tenantId));
});

/** DELETE /tenant/mail-settings/google — desconecta (revoca en Google). */
const googleDisconnect = asyncHandler(async (req, res) => {
  const r = await googleMail.disconnectGoogle(req.db, req.tenantId);
  res.status(200).json({ ...r, ...(await service.getMailSettings(req.db, req.tenantId)) });
});

/** POST /tenant/mail-settings/google/test — { to } */
const googleTest = asyncHandler(async (req, res) => {
  const { to } = z.object({ to: email }).parse(req.body || {});
  res.status(200).json(await googleMail.testGoogle(req.db, req.tenantId, { to }));
});

module.exports = { get, save, remove, test, googleConnect, googleCallback, googleUpdate, googleDisconnect, googleTest };
