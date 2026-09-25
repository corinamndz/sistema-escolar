const { ApiError } = require('../../utils/ApiError');
const { toPublicUrl } = require('../../services/storage/logoStorage');

async function getSettings(trx, tenantId) {
  const tenant = await trx('tenants').where({ id: tenantId }).first();
  if (!tenant) throw ApiError.notFound('Colegio no encontrado.');

  const settings = await trx('tenant_settings').where({ tenant_id: tenantId }).first();

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    // En BD se guarda la ruta relativa (logos/<tenant>/<archivo>); al cliente se le da la URL servible.
    logoUrl: toPublicUrl(settings?.logo_url),
    primaryColor: settings?.primary_color || '#2563EB',
    secondaryColor: settings?.secondary_color || '#1E293B',
    contactPhone: settings?.contact_phone || null,
    contactEmail: settings?.contact_email || null,
  };
}

/**
 * Actualiza la configuración del colegio. `logoPath` es la ruta relativa de un
 * logo recién guardado en disco; `removeLogo` lo quita sin reemplazarlo.
 * Devuelve `replacedLogo` (la ruta anterior) para que el controlador borre el
 * archivo viejo una vez confirmada la transacción.
 */
async function updateSettings(
  trx,
  tenantId,
  { name, logoPath, removeLogo, primaryColor, secondaryColor, contactPhone, contactEmail }
) {
  if (name) {
    await trx('tenants').where({ id: tenantId }).update({ name, updated_at: trx.fn.now() });
  }

  const existing = await trx('tenant_settings').where({ tenant_id: tenantId }).first();

  let logoValue;
  if (logoPath) logoValue = logoPath;
  else if (removeLogo) logoValue = null;

  const payload = {
    logo_url: logoValue,
    primary_color: primaryColor,
    secondary_color: secondaryColor,
    contact_phone: contactPhone,
    contact_email: contactEmail,
    updated_at: trx.fn.now(),
  };
  // Solo pisa las columnas que vinieron en el request (permite updates parciales).
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  if (existing) {
    await trx('tenant_settings').where({ tenant_id: tenantId }).update(payload);
  } else {
    await trx('tenant_settings').insert({ tenant_id: tenantId, ...payload });
  }

  const replacedLogo = logoValue !== undefined && existing?.logo_url !== logoValue ? existing?.logo_url || null : null;

  return { settings: await getSettings(trx, tenantId), replacedLogo };
}

module.exports = { getSettings, updateSettings };
