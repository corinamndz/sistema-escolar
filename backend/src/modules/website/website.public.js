const router = require('express').Router();
const { z } = require('zod');
const { db, withTenantTransaction } = require('../../config/database');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { rateLimit } = require('../../utils/rateLimit');
const service = require('./website.service');
const intake = require('../enrollment-forms/publicIntake.service');

/**
 * Rutas públicas del mini-sitio del colegio, SIN sesión:
 *   GET  /api/public/sites/:slug          la página (404 si no está publicada)
 *   GET  /api/public/sites/:slug/intake   la solicitud de cupo (si el colegio la habilitó)
 *   POST /api/public/sites/:slug/intake   enviar una solicitud de cupo
 */
const slugOf = (req) =>
  String(req.params.slug || '')
    .trim()
    .toLowerCase();

router.get(
  '/sites/:slug',
  asyncHandler(async (req, res) => {
    const data = await service.getPublic(slugOf(req));
    // Revalidar siempre: un cambio guardado se ve al recargar.
    res.set('Cache-Control', 'no-cache');
    res.status(200).json(data);
  })
);

const unavailable = () => ApiError.notFound('La solicitud de cupo no está disponible en este momento.');

/** Dentro de la transacción del colegio de un sitio PUBLICADO; si no, 404 (mismo mensaje: no revela si existe). */
async function inPublishedSite(slug, fn) {
  const tenant = await service.resolveSlug(db, slug);
  if (!tenant) throw unavailable();
  return withTenantTransaction(tenant.id, async (trx) => {
    const site = await trx('school_websites').where({ tenant_id: tenant.id }).first('is_published');
    if (!site?.is_published) throw unavailable();
    return fn(trx, tenant.id);
  });
}

router.get(
  '/sites/:slug/intake',
  asyncHandler(async (req, res) => {
    const data = await inPublishedSite(slugOf(req), (trx, tenantId) => intake.publicForm(trx, tenantId));
    res.set('Cache-Control', 'no-cache');
    res.status(200).json(data);
  })
);

// Contra abusos: pocas solicitudes por persona (IP) y un tope por colegio.
const perIp = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, key: (req) => `${req.ip}|${slugOf(req)}`, message: 'Ya enviaste varias solicitudes desde esta conexión. Inténtalo de nuevo en una hora.' });
const perSchool = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: (req) => slugOf(req), message: 'El colegio está recibiendo muchas solicitudes ahora mismo. Inténtalo de nuevo más tarde.' });

const intakeSchema = z.object({
  // Opcionales aquí: si la planilla ya los pregunta, se toman de sus respuestas;
  // el servicio exige al final nombre del aspirante, nombre y teléfono de contacto.
  applicantName: z.string().trim().max(150, 'Máximo 150 caracteres.').optional().default(''),
  contact: z
    .object({
      name: z.string().trim().max(150, 'Máximo 150 caracteres.').optional().default(''),
      national_id: z.string().trim().max(30, 'Máximo 30 caracteres.').optional().default(''),
      phone: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(30).optional()),
      email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().email('Correo inválido.').max(150).optional()),
    })
    .default({}),
  answers: z.record(z.any()).default({}),
  // Campo trampa (oculto para las personas: los robots lo llenan) y tiempo de llenado.
  website: z.string().max(0, 'Solicitud no válida.').optional().default(''),
  elapsed_ms: z.number().int().min(3000, 'Solicitud no válida.'),
});

router.post(
  '/sites/:slug/intake',
  perIp,
  perSchool,
  asyncHandler(async (req, res) => {
    const input = intakeSchema.parse(req.body);
    const result = await inPublishedSite(slugOf(req), (trx, tenantId) => intake.submit(trx, tenantId, input, { ip: req.ip, userAgent: req.get('user-agent') }));
    res.status(201).json({ ok: true, id: result.id, applicant_name: result.applicant_name, contact: result.contact });
  })
);

module.exports = router;
module.exports.limits = { perIp, perSchool };
module.exports.intakeSchema = intakeSchema;
