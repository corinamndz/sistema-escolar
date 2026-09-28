const router = require('express').Router();
const { z } = require('zod');
const { db, withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const { asyncHandler } = require('../../utils/asyncHandler');
const { toPublicUrl } = require('../../services/storage/logoStorage');

/**
 * Branding PÚBLICO de un colegio, para pintar el login antes de autenticarse.
 *
 * Sin autenticación a propósito: solo expone lo que el colegio ya muestra al
 * mundo (nombre, logo, colores). Nada de contactos, ids internos ni estado.
 * Un slug inexistente o un colegio no activo responden 404 con el mismo
 * mensaje, para no revelar qué colegios existen suspendidos.
 */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, 'Identificador de colegio inválido.');

const getBranding = asyncHandler(async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);

  // `tenants` no tiene RLS (es el registro raíz, igual que en el login).
  const tenant = await db('tenants').where({ slug, status: 'active' }).first();
  if (!tenant) throw ApiError.notFound('Colegio no encontrado.');

  // `tenant_settings` SÍ tiene RLS: se lee con app.tenant_id fijado.
  const settings = await withTenantTransaction(tenant.id, (trx) =>
    trx('tenant_settings').where({ tenant_id: tenant.id }).first()
  );

  // `no-cache` = el navegador puede guardar la respuesta pero DEBE revalidarla con
  // el servidor en cada uso (Express agrega un ETag: si nada cambió responde 304
  // sin cuerpo). Antes era `max-age=300` y el navegador seguía mostrando los
  // colores viejos hasta 5 minutos después de guardarlos en Configuración.
  res.set('Cache-Control', 'no-cache');
  res.status(200).json({
    slug: tenant.slug,
    name: tenant.name,
    logoUrl: toPublicUrl(settings?.logo_url),
    primaryColor: settings?.primary_color || '#2563EB',
    secondaryColor: settings?.secondary_color || '#1E293B',
  });
});

router.get('/tenants/:slug/branding', getBranding);

module.exports = router;
