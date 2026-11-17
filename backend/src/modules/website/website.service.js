const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { db, withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const { toPublicUrl, saveLogo } = require('../../services/storage/logoStorage');
const { isOwnWebsiteImage } = require('../../services/storage/websiteImageStorage');
const { SANITIZE } = require('../notifications/announcement.service');
const publicIntake = require('../enrollment-forms/publicIntake.service');
const { websiteEvents } = require('../events/event.service');

/**
 * Mini-sitio web institucional (migraciones 095, 096 y 097).
 *
 * Cada colegio tiene una página pública en /colegio/<slug>, sin sesión, con su
 * eslogan, historia, misión, visión, galería y redes. El nombre, el logo y los
 * datos de contacto vienen de Configuración (tenant_settings): un solo lugar.
 *
 *   slug   tenants.website_slug (personalizado) o, si no hay, tenants.slug.
 *          La URL con el slug del colegio sigue funcionando aunque se elija otro.
 *   Solo con is_published = true la página es visible; si no, 404 (como si no existiera).
 *   template   distribución de la página (classic | modern | minimal | academic)
 *   sections   secciones adicionales en su orden: [{ id, title, body_html, image_url, visible }]
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
// Primeros segmentos de la app (frontend/src/lib/tenantPath.js, APP_ROUTES): un slug así no se puede abrir.
const RESERVED = new Set(['colegio', 'website', 'login', 'api', 'storage', 'assets', 'admin', 'www', 'portal', 'tenant', 'support']);
const SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'whatsapp', 'website'];
const MAX_GALLERY = 24;
const MAX_SECTIONS = 12;
// Catálogo de plantillas (claves): el diseño de cada una está en el frontend
// (features/website/templates.js). Migración 101: misma lista en el CHECK.
const TEMPLATES = ['classic', 'modern', 'minimal', 'academic', 'prestige', 'playful', 'magazine', 'portal', 'showcase', 'contrast'];
// Tipografías que el colegio puede elegir (null = la de la plantilla).
const FONTS = ['sans', 'serif', 'rounded', 'elegant'];

/**
 * Texto de las secciones: la misma lista blanca que los comunicados, SIN imágenes
 * (cada sección tiene la suya, subida al colegio): ni scripts, ni estilos libres,
 * ni enlaces javascript:.
 */
const SECTION_SANITIZE = {
  ...SANITIZE,
  allowedTags: SANITIZE.allowedTags.filter((t) => t !== 'img'),
  allowedAttributes: Object.fromEntries(Object.entries(SANITIZE.allowedAttributes).filter(([t]) => t !== 'img')),
  exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
};
const plain = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').trim();

const EMPTY = {
  tagline: null,
  primary_color: null,
  secondary_color: null,
  banner_url: null,
  history: null,
  mission: null,
  vision: null,
  gallery: [],
  gallery_autoplay: false,
  font: null,
  welcome_title: null,
  welcome_text: null,
  welcome_signature: null,
  show_quick_links: true,
  social: {},
  show_contact: true,
  template: 'classic',
  sections: [],
  is_published: false,
  published_at: null,
};

/** Datos del colegio que el sitio muestra pero no guarda (Configuración). */
async function schoolOf(trx, tenantId) {
  // En la misma transacción: ve un slug recién cambiado. `tenants` no tiene RLS.
  const tenant = await trx('tenants').where({ id: tenantId }).first('id', 'name', 'slug', 'website_slug');
  const s = (await trx('tenant_settings').where({ tenant_id: tenantId }).first()) || {};
  return {
    tenant,
    school: {
      name: tenant.name,
      logo_url: toPublicUrl(s.logo_url) || null,
      primary_color: s.primary_color || '#2563EB',
      secondary_color: s.secondary_color || '#1E293B',
      phone: s.contact_phone || null,
      email: s.contact_email || null,
      address: s.address || null,
      login_slug: tenant.slug,
    },
  };
}

const rowOf = (r) => (r ? { ...EMPTY, ...r, gallery: r.gallery || [], social: r.social || {}, sections: r.sections || [] } : { ...EMPTY });

/**
 * GET /website — lo que necesita el editor: el contenido guardado, los datos del
 * colegio (para la vista previa) y la dirección pública.
 */
async function getForEditor(trx, tenantId) {
  const { tenant, school } = await schoolOf(trx, tenantId);
  const site = rowOf(await trx('school_websites').where({ tenant_id: tenantId }).first());
  const form = await publicIntake.activeIntake(trx, tenantId);
  return {
    site,
    school,
    // Solicitud de cupo habilitada (Diseño de planillas): la vista previa la muestra igual que la página.
    intake: form ? { title: form.title, school_period_name: form.school_period_name } : null,
    // Próximos eventos de la cartelera marcados para la web (099): la vista previa los muestra igual.
    events: await websiteEvents(trx, tenantId),
    slug: {
      current: tenant.website_slug || tenant.slug,
      custom: tenant.website_slug,
      default: tenant.slug,
    },
    limits: { gallery: MAX_GALLERY, social: SOCIAL_KEYS, sections: MAX_SECTIONS, templates: TEMPLATES, fonts: FONTS },
  };
}

/** El slug personalizado está libre: válido, no reservado, sin usar por otro colegio (ni como su slug ni como el de su sitio). */
async function assertSlugFree(trx, tenantId, slug) {
  if (!SLUG_RE.test(slug)) throw ApiError.badRequest('La dirección solo puede tener letras minúsculas, números y guiones (sin espacios ni tildes).', [{ path: 'slug', message: 'Formato inválido.' }]);
  if (RESERVED.has(slug)) throw ApiError.badRequest(`«${slug}» es una palabra reservada de la plataforma.`, [{ path: 'slug', message: 'Palabra reservada.' }]);
  const taken = await trx('tenants')
    .whereNot({ id: tenantId })
    .where((q) => q.where({ slug }).orWhere({ website_slug: slug }))
    .first('id');
  if (taken) throw ApiError.conflict('Esa dirección ya la usa otro colegio: elige otra.', [{ path: 'slug', message: 'Ya está en uso.' }]);
}

/**
 * PUT /website — guarda el contenido (y el slug personalizado). Las imágenes deben
 * ser de este colegio (subidas con POST /website/images): no se aceptan URLs externas.
 * → { ...editor, removed: [urls que ya no se usan, para borrar al confirmar] }
 */
async function save(trx, tenantId, userId, input) {
  const before = rowOf(await trx('school_websites').where({ tenant_id: tenantId }).first());
  const sectionsIn = input.sections || [];
  const urls = [input.banner_url, ...input.gallery.map((g) => g.url), ...sectionsIn.map((s) => s.image_url)].filter(Boolean);
  if (urls.some((u) => !isOwnWebsiteImage(tenantId, u))) throw ApiError.badRequest('Una de las imágenes no es válida: vuelve a subirla.');
  if (input.gallery.length > MAX_GALLERY) throw ApiError.badRequest(`Máximo ${MAX_GALLERY} fotos en la galería.`, [{ path: 'gallery', message: 'Demasiadas fotos.' }]);
  if (sectionsIn.length > MAX_SECTIONS) throw ApiError.badRequest(`Máximo ${MAX_SECTIONS} secciones adicionales.`, [{ path: 'sections', message: 'Demasiadas secciones.' }]);
  if (input.template && !TEMPLATES.includes(input.template)) throw ApiError.badRequest('Plantilla inválida.', [{ path: 'template', message: 'Plantilla inválida.' }]);
  // Secciones: texto saneado en el servidor; el orden es el del arreglo.
  const sections = sectionsIn.map((s, i) => {
    const body = sanitizeHtml(String(s.body_html || ''), SECTION_SANITIZE).trim();
    if (!s.title?.trim() && !plain(body) && !s.image_url) throw ApiError.badRequest(`La sección ${i + 1} está vacía: escribe su título o su contenido, o quítala.`, [{ path: `sections.${i}.title`, message: 'Sección vacía.' }]);
    return { id: /^[\w-]{1,40}$/.test(s.id || '') ? s.id : crypto.randomUUID(), title: (s.title || '').trim(), body_html: body, image_url: s.image_url || null, visible: s.visible !== false };
  });

  const { tenant } = await schoolOf(trx, tenantId);
  // Slug: vacío o igual al del colegio = el del colegio (sin personalizar).
  const wanted = input.slug ? input.slug.trim().toLowerCase() : null;
  const custom = wanted && wanted !== tenant.slug ? wanted : null;
  if (custom && custom !== tenant.website_slug) await assertSlugFree(trx, tenantId, custom);

  const values = {
    tagline: input.tagline || null,
    primary_color: input.primary_color || null,
    secondary_color: input.secondary_color || null,
    banner_url: input.banner_url || null,
    history: input.history || null,
    mission: input.mission || null,
    vision: input.vision || null,
    gallery: JSON.stringify(input.gallery.map((g) => ({ url: g.url, caption: g.caption || '' }))),
    gallery_autoplay: Boolean(input.gallery_autoplay),
    font: FONTS.includes(input.font) ? input.font : null,
    welcome_title: input.welcome_title || null,
    welcome_text: input.welcome_text || null,
    welcome_signature: input.welcome_signature || null,
    show_quick_links: input.show_quick_links !== false,
    social: JSON.stringify(Object.fromEntries(SOCIAL_KEYS.filter((k) => input.social?.[k]).map((k) => [k, input.social[k]]))),
    show_contact: input.show_contact,
    template: input.template || 'classic',
    sections: JSON.stringify(sections),
    updated_by: userId,
    updated_at: trx.fn.now(),
  };
  await trx('school_websites')
    .insert({ tenant_id: tenantId, ...values })
    .onConflict('tenant_id')
    .merge(values);
  if (custom !== (tenant.website_slug || null)) {
    try {
      await trx.transaction((sp) => sp('tenants').where({ id: tenantId }).update({ website_slug: custom }));
    } catch (err) {
      if (err.code === '23505') throw ApiError.conflict('Esa dirección ya la usa otro colegio: elige otra.', [{ path: 'slug', message: 'Ya está en uso.' }]);
      throw err;
    }
  }
  const kept = new Set(urls);
  const removed = [before.banner_url, ...before.gallery.map((g) => g.url), ...before.sections.map((s) => s.image_url)].filter((u) => u && !kept.has(u));
  return { ...(await getForEditor(trx, tenantId)), removed };
}

/**
 * POST /website/logo — cambia el logo OFICIAL del colegio (el mismo de
 * Configuración → General: un solo logo para todo el sistema).
 * → { ...editor, previous: ruta del logo anterior, para borrarlo al confirmar }
 */
async function setLogo(trx, tenantId, userId, buffer) {
  const stored = await saveLogo(tenantId, buffer); // valida PNG/JPG por su firma
  const before = await trx('tenant_settings').where({ tenant_id: tenantId }).first('logo_url');
  if (before) await trx('tenant_settings').where({ tenant_id: tenantId }).update({ logo_url: stored, updated_at: trx.fn.now() });
  else await trx('tenant_settings').insert({ tenant_id: tenantId, logo_url: stored });
  return { ...(await getForEditor(trx, tenantId)), created: stored, previous: before?.logo_url || null };
}

/** PUT /website/publish — visible o no para el público. */
async function setPublished(trx, tenantId, userId, published) {
  await trx('school_websites')
    .insert({
      tenant_id: tenantId,
      is_published: published,
      published_at: published ? trx.fn.now() : null,
      updated_by: userId,
    })
    .onConflict('tenant_id')
    .merge({
      is_published: published,
      published_at: published ? trx.fn.now() : null,
      updated_by: userId,
      updated_at: trx.fn.now(),
    });
  return getForEditor(trx, tenantId);
}

/**
 * GET /api/public/sites/:slug — la página pública, sin sesión. Busca primero el
 * slug personalizado y después el del colegio. Un colegio inexistente, inactivo
 * o con el sitio sin publicar responden 404 con el MISMO mensaje.
 */
const notFound = () => ApiError.notFound('Esta página no existe o el colegio aún no la ha publicado.');

/** El colegio de un slug público (primero el personalizado, luego el del colegio), o null. */
async function resolveSlug(conn, slug) {
  if (!SLUG_RE.test(slug)) return null;
  // `tenants` no tiene RLS (registro raíz, igual que el login).
  return (await conn('tenants').where({ website_slug: slug, status: 'active' }).first('id')) || (await conn('tenants').where({ slug, status: 'active' }).first('id')) || null;
}

/** Lo que ve el público, dentro de la transacción del colegio; 404 si no está publicado. */
async function publicPayload(trx, tenantId) {
  const row = await trx('school_websites').where({ tenant_id: tenantId }).first();
  if (!row?.is_published) throw notFound();
  const { tenant: t, school } = await schoolOf(trx, tenantId);
  const site = rowOf(row);
  // Solicitud de cupo (098): si el colegio habilitó una planilla en la web.
  const form = await publicIntake.activeIntake(trx, tenantId);
  return {
    slug: t.website_slug || t.slug,
    intake: form ? { title: form.title, school_period_name: form.school_period_name } : null,
    // «Próximos eventos» (099): en vivo desde la cartelera, sin caché.
    events: await websiteEvents(trx, tenantId),
    school: {
      name: school.name,
      logo_url: school.logo_url,
      login_slug: school.login_slug,
      // Contacto solo si el colegio lo quiere mostrar.
      ...(site.show_contact ? { phone: school.phone, email: school.email, address: school.address } : {}),
    },
    site: {
      tagline: site.tagline,
      primary_color: site.primary_color || school.primary_color,
      secondary_color: site.secondary_color || school.secondary_color,
      banner_url: site.banner_url,
      history: site.history,
      mission: site.mission,
      vision: site.vision,
      gallery: site.gallery,
      gallery_autoplay: Boolean(site.gallery_autoplay),
      social: site.social,
      template: site.template,
      font: site.font || null,
      welcome_title: site.welcome_title,
      welcome_text: site.welcome_text,
      welcome_signature: site.welcome_signature,
      show_quick_links: site.show_quick_links !== false,
      // Solo las visibles, en su orden.
      sections: site.sections.filter((s) => s.visible !== false).map(({ id, title, body_html, image_url }) => ({ id, title, body_html, image_url })),
    },
  };
}

async function getPublic(slug) {
  const tenant = await resolveSlug(db, slug);
  if (!tenant) throw notFound();
  return withTenantTransaction(tenant.id, (trx) => publicPayload(trx, tenant.id));
}

module.exports = {
  SOCIAL_KEYS,
  MAX_GALLERY,
  MAX_SECTIONS,
  TEMPLATES,
  FONTS,
  setLogo,
  getForEditor,
  save,
  setPublished,
  getPublic,
  resolveSlug,
  publicPayload,
  assertSlugFree,
};
