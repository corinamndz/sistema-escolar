const { z } = require('zod');
const tenantService = require('./tenant.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { saveLogo, deleteLogo } = require('../../services/storage/logoStorage');

const getSettings = asyncHandler(async (req, res) => {
  const settings = await tenantService.getSettings(req.db, req.tenantId);
  res.status(200).json(settings);
});

// El body llega como multipart/form-data: todos los campos son strings y un
// input vacío llega como "". Se normaliza "" → undefined para que no pise datos.
const optional = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const updateSettingsSchema = z.object({
  name: optional(z.string().trim().min(1).max(150)),
  primaryColor: optional(z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color hex inválido, ej. #2563EB')),
  secondaryColor: optional(z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color hex inválido, ej. #1E293B')),
  // Apariencia avanzada: degradado del menú, acento secundario ('auto' = automático) y encabezados de tabla.
  menuGradient: optional(z.enum(['deep', 'analogous', 'solid'])),
  accentSecondaryColor: optional(z.union([z.literal('auto'), z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color hex inválido, ej. #F59E0B')])),
  tableHeaderStyle: optional(z.enum(['subtle', 'solid', 'neutral'])),
  contactPhone: optional(z.string().max(30)),
  contactEmail: optional(z.string().email('Correo inválido.')),
  // "true" para quitar el logo actual sin subir uno nuevo.
  removeLogo: optional(z.enum(['true', 'false']).transform((v) => v === 'true')),
});

/**
 * PUT /tenant/settings (multipart/form-data)
 * Campos de texto: name, primaryColor, secondaryColor, menuGradient, accentSecondaryColor,
 * tableHeaderStyle, contactPhone, contactEmail, removeLogo.
 * Archivo opcional: `logo` (PNG/JPG, máx. 2 MB), procesado por `logoUpload`.
 */
const updateSettings = asyncHandler(async (req, res) => {
  const data = updateSettingsSchema.parse(req.body);

  // Se escribe el archivo solo después de validar los campos de texto.
  const newLogoPath = req.file ? await saveLogo(req.tenantId, req.file.buffer) : undefined;

  // La transacción del tenant se confirma o revierte cuando la respuesta termina
  // (ver tenant.middleware.js). Recién ahí se sabe qué archivo sobra en disco:
  // si todo salió bien, el logo anterior; si falló, el recién subido.
  let replacedLogo = null;
  res.on('finish', () => {
    if (res.statusCode < 400) deleteLogo(replacedLogo);
    else if (newLogoPath) deleteLogo(newLogoPath);
  });

  let result;
  try {
    result = await tenantService.updateSettings(req.db, req.tenantId, {
      ...data,
      logoPath: newLogoPath,
    });
  } catch (err) {
    // Detalle exacto en la consola del servidor (código y columna/consulta de
    // PostgreSQL) para diagnosticar; la respuesta la arma el manejador global.
    if (!(err instanceof ApiError)) {
      // eslint-disable-next-line no-console
      console.error('[PUT /tenant/settings] Falló el guardado', {
        tenantId: req.tenantId,
        campos: Object.keys(data),
        logoNuevo: Boolean(newLogoPath),
        code: err.code,
        column: err.column,
        detail: err.detail,
        message: err.message,
      });
    }
    throw err;
  }
  replacedLogo = result.replacedLogo;

  res.status(200).json(result.settings);
});

/** GET /tenant/profile — perfil público del colegio para cualquier usuario con sesión. */
const getProfile = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.status(200).json(await tenantService.getProfile(req.db, req.tenantId));
});

module.exports = { getSettings, getProfile, updateSettings };
