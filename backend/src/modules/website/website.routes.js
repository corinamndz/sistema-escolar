const router = require('express').Router();
const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requireAdmin } = require('../../middlewares/admin.middleware');
const { announcementImageUpload, logoUpload } = require('../../middlewares/upload.middleware');
const { deleteLogo } = require('../../services/storage/logoStorage');
const { ApiError } = require('../../utils/ApiError');
const { saveWebsiteImage, removeWebsiteImages } = require('../../services/storage/websiteImageStorage');
const service = require('./website.service');

/**
 * Editor del mini-sitio web del colegio (Administración → Sitio web): solo el
 * Administrador. La página pública está en website.public.js (sin sesión).
 */
router.use(authMiddleware, tenantMiddleware, requireAdmin);

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max, `Máximo ${max} caracteres.`).nullable().optional());
const color = z.preprocess(
  (v) => (v === '' ? null : v),
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido.')
    .nullable()
    .optional(),
);
// Solo enlaces web (https/http): nada de javascript: ni data:.
const link = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v),
  z
    .string()
    .max(300, 'Máximo 300 caracteres.')
    .url('Enlace inválido: debe empezar con https://')
    .refine((v) => /^https?:\/\//i.test(v), 'El enlace debe empezar con https://')
    .nullable()
    .optional(),
);

const siteSchema = z.object({
  slug: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toLowerCase().max(60, 'Máximo 60 caracteres.').nullable().optional()),
  tagline: text(160),
  primary_color: color,
  secondary_color: color,
  banner_url: text(200),
  history: text(6000),
  mission: text(3000),
  vision: text(3000),
  gallery: z
    .array(
      z.object({
        url: z.string().max(200),
        caption: z.string().trim().max(140, 'Máximo 140 caracteres.').optional().default(''),
      }),
    )
    .max(service.MAX_GALLERY, `Máximo ${service.MAX_GALLERY} fotos.`)
    .default([]),
  gallery_autoplay: z.boolean().default(false),
  social: z
    .object(Object.fromEntries(service.SOCIAL_KEYS.map((k) => [k, link])))
    .partial()
    .default({}),
  show_contact: z.boolean().default(true),
  font: z.preprocess((v) => (v === '' ? null : v), z.enum(service.FONTS, { errorMap: () => ({ message: 'Tipografía inválida.' }) }).nullable().default(null)),
  welcome_title: text(120),
  welcome_text: text(1500),
  welcome_signature: text(120),
  show_quick_links: z.boolean().default(true),
  template: z.enum(service.TEMPLATES, { errorMap: () => ({ message: 'Plantilla inválida.' }) }).default('classic'),
  sections: z
    .array(
      z.object({
        id: z.string().max(40).optional(),
        title: z.string().trim().max(120, 'Máximo 120 caracteres.').optional().default(''),
        body_html: z.string().max(60000, 'El texto es demasiado largo.').optional().default(''),
        image_url: z.preprocess((v) => (v === '' ? null : v), z.string().max(200).nullable().optional()),
        visible: z.boolean().optional().default(true),
      })
    )
    .max(service.MAX_SECTIONS, `Máximo ${service.MAX_SECTIONS} secciones.`)
    .default([]),
});

router.get(
  '/',
  asyncHandler(async (req, res) => res.status(200).json(await service.getForEditor(req.db, req.tenantId))),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const { removed, ...result } = await service.save(req.db, req.tenantId, req.user.id, siteSchema.parse(req.body));
    // Las imágenes que el sitio dejó de usar se borran solo si el guardado se confirmó.
    res.once('finish', () => {
      if (res.statusCode < 300 && removed.length) removeWebsiteImages(req.tenantId, removed);
    });
    res.status(200).json(result);
  }),
);

router.put(
  '/publish',
  asyncHandler(async (req, res) => {
    const { published } = z.object({ published: z.boolean() }).parse(req.body);
    res.status(200).json(await service.setPublished(req.db, req.tenantId, req.user.id, published));
  }),
);

/**
 * POST /website/logo (multipart, campo `logo`, PNG o JPG) — el logo oficial del
 * colegio, el mismo de Configuración. El anterior se borra solo si se confirmó.
 */
router.post(
  '/logo',
  logoUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Elige el logo.', [{ path: 'logo', message: 'Requerido.' }]);
    const { created, previous, ...result } = await service.setLogo(req.db, req.tenantId, req.user.id, req.file.buffer);
    res.once('finish', () => {
      if (res.statusCode < 300) {
        if (previous && previous !== created) deleteLogo(previous);
      } else deleteLogo(created); // no se guardó: el archivo nuevo sobra
    });
    res.status(200).json(result);
  })
);

/** POST /website/images (multipart, campo `image`) → { url }. Se usa al guardar el sitio. */
router.post(
  '/images',
  announcementImageUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Elige una imagen.', [{ path: 'image', message: 'Requerido.' }]);
    res.status(201).json({ url: await saveWebsiteImage(req.tenantId, req.file.buffer) });
  }),
);

module.exports = router;
