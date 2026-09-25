const { z } = require('zod');
const tenantService = require('./tenant.service');
const { asyncHandler } = require('../../utils/asyncHandler');
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
  contactPhone: optional(z.string().max(30)),
  contactEmail: optional(z.string().email('Correo inválido.')),
  // "true" para quitar el logo actual sin subir uno nuevo.
  removeLogo: optional(z.enum(['true', 'false']).transform((v) => v === 'true')),
});

/**
 * PUT /tenant/settings (multipart/form-data)
 * Campos de texto: name, primaryColor, secondaryColor, contactPhone, contactEmail, removeLogo.
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

  const result = await tenantService.updateSettings(req.db, req.tenantId, {
    ...data,
    logoPath: newLogoPath,
  });
  replacedLogo = result.replacedLogo;

  res.status(200).json(result.settings);
});

module.exports = { getSettings, updateSettings };
