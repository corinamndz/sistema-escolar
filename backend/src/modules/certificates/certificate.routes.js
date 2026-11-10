const router = require('express').Router();
const multer = require('multer');
const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { requireAdmin } = require('../../middlewares/admin.middleware');
const { denyTeachers } = require('../access/teacherScope');
const service = require('./certificate.service');
const { FONT_KEYS } = require('../../services/pdf/certificateFonts');
const { STANDARD_KEYS } = require('../../services/pdf/standardCertificates');
const storage = require('../../services/storage/certificateStorage');

/**
 * Certificado de promoción. Diseñarlo: solo el Administrador. Emitirlo: quien ve
 * Cierre y promoción (nunca un docente). El colegio es siempre el de la sesión.
 */
router.use(authMiddleware, tenantMiddleware);

const MAX_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 5 } }).single('background');
const backgroundUpload = (req, res, next) =>
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'El fondo no puede pesar más de 10 MB.' : 'No se pudo procesar el archivo subido.';
      return next(ApiError.badRequest(message, [{ path: 'background', message }]));
    }
    return next(err);
  });

const uuid = z.string().uuid('Identificador inválido.');
const empty = (v) => (v === '' || v === undefined ? null : v);
/** Alcance del diseño: año escolar y nivel; vacío = todos. */
const scopeOf = (req) => ({
  schoolPeriodId: z.preprocess(empty, uuid.nullable()).parse(req.query.schoolPeriodId),
  levelCode: z.preprocess(empty, z.string().regex(/^[a-z_]{1,20}$/, 'Nivel inválido.').nullable()).parse(req.query.levelCode),
});
const MAX_BLOCKS = 30;
const placed = {
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  fontSize: z.number().min(6, 'Mínimo 6 puntos.').max(120, 'Máximo 120 puntos.'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido.'),
  align: z.enum(['left', 'center', 'right']),
  font: z.enum(FONT_KEYS),
  bold: z.boolean(),
};
const variableSchema = z.object({ type: z.literal('variable').optional(), key: z.enum(service.VARIABLES), ...placed });
const customTextSchema = z.object({
  type: z.literal('custom_text'),
  id: z.string().regex(/^[\w-]{1,40}$/, 'Identificador inválido.'),
  content: z.string().max(2000, 'Máximo 2000 caracteres por bloque.').refine((v) => v.trim().length > 0, 'Escribe el texto del bloque.'),
  width: z.number().min(0.05).max(1),
  ...placed,
});

/** Logo del colegio: caja de ancho y alto en fracciones de la hoja (ver certificateGenerator.drawLogo). */
const logoSchema = z.object({
  type: z.literal('logo'),
  id: z.literal('logo'),
  x: placed.x,
  y: placed.y,
  width: z.number().min(0.02, 'El logo es demasiado pequeño.').max(1),
  height: z.number().min(0.02, 'El logo es demasiado pequeño.').max(1),
  align: placed.align,
});
const SCHEMA_BY_TYPE = { custom_text: customTextSchema, logo: logoSchema };

/** Variables (cada una una sola vez), bloques de texto libre (type: 'custom_text') y el logo (type: 'logo', uno). */
function parseFields(body) {
  const list = z.array(z.any()).parse(body?.fields);
  const fields = list.map((f) => (SCHEMA_BY_TYPE[f?.type] || variableSchema).parse(f));
  if (fields.filter((f) => f.type === 'logo').length > 1) throw ApiError.badRequest('El logo se coloca una sola vez.');
  const custom = fields.filter((f) => f.type === 'custom_text');
  // Un nombre mal escrito saldría tal cual en un documento oficial: se rechaza al guardar.
  for (const f of custom) {
    const unknown = [...f.content.matchAll(/\{\{\s*(\w*)\s*\}\}/g)].map((m) => m[1]).filter((k) => !service.VARIABLES.includes(k));
    if (unknown.length) throw ApiError.badRequest(`Variable desconocida en el texto: {{${unknown[0]}}}. Usa ${service.VARIABLES.map((v) => `{{${v}}}`).join(', ')}.`);
  }
  const variables = fields.filter((f) => f.type !== 'custom_text' && f.type !== 'logo');
  if (custom.length > MAX_BLOCKS) throw ApiError.badRequest(`Máximo ${MAX_BLOCKS} bloques de texto libre.`);
  if (new Set(variables.map((f) => f.key)).size !== variables.length) throw ApiError.badRequest('Cada variable se coloca una sola vez.');
  if (new Set(custom.map((f) => f.id)).size !== custom.length) throw ApiError.badRequest('Hay bloques de texto repetidos.');
  return fields;
}

/**
 * Limpieza de archivos al reemplazar el fondo, cuando ya se sabe si quedó guardado:
 * la transacción se confirma antes de terminar la respuesta (tenant.middleware), y
 * si la confirmación falla la respuesta sale con error. Guardado: se borra el fondo
 * anterior. Fallo o conexión cortada: se borra el nuevo y el anterior sigue en uso.
 */
function settleBackgroundFiles(res, tenantId, { created, previous }) {
  let settled = false;
  const settle = (saved) => {
    if (settled) return;
    settled = true;
    const obsolete = saved ? previous : created;
    if (obsolete) storage.removeBackground(tenantId, obsolete);
  };
  res.once('finish', () => settle(res.statusCode < 400));
  res.once('close', () => settle(false));
}

const sendPdf = (res, { buffer, fileName }) => {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
  res.status(200).send(buffer);
};

router.get('/', requireAdmin, asyncHandler(async (req, res) => res.status(200).json(await service.getTemplate(req.db, req.tenantId, scopeOf(req)))));

/** GET /certificate-template/standard/:key/pdf — fondo de una plantilla estándar con el color del colegio. */
router.get(
  '/standard/:key/pdf',
  requireAdmin,
  asyncHandler(async (req, res) => sendPdf(res, await service.standardPreview(req.db, req.tenantId, z.enum(STANDARD_KEYS).parse(req.params.key))))
);

/** POST /certificate-template/standard/:key?… — usa esa plantilla estándar como fondo de ese alcance. */
router.post(
  '/standard/:key',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { created, previous, ...result } = await service.applyStandard(req.db, req.tenantId, req.user.id, scopeOf(req), z.enum(STANDARD_KEYS).parse(req.params.key));
    settleBackgroundFiles(res, req.tenantId, { created, previous });
    res.status(200).json(result);
  })
);

/** POST /certificate-template/customize?… — crea el diseño propio de ese alcance copiando el que hereda. */
router.post(
  '/customize',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { created, ...result } = await service.customize(req.db, req.tenantId, req.user.id, scopeOf(req));
    settleBackgroundFiles(res, req.tenantId, { created, previous: null });
    res.status(201).json(result);
  })
);

/** DELETE /certificate-template?… — elimina el diseño propio de ese alcance (vuelve a usar el que hereda). */
router.delete(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { previous } = await service.removeDesign(req.db, req.tenantId, scopeOf(req));
    settleBackgroundFiles(res, req.tenantId, { created: null, previous });
    res.status(200).json({ ok: true });
  })
);

router.post(
  '/background',
  requireAdmin,
  backgroundUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Elige el archivo del fondo.', [{ path: 'background', message: 'Requerido.' }]);
    const { created, previous, ...result } = await service.saveBackground(req.db, req.tenantId, req.user.id, scopeOf(req), req.file.buffer);
    settleBackgroundFiles(res, req.tenantId, { created, previous });
    res.status(200).json(result);
  })
);

router.get(
  '/background',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { full, type } = await service.backgroundFile(req.db, req.tenantId, scopeOf(req));
    res.set({ 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' }[type], 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(full);
  })
);

router.put(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.status(200).json(await service.saveFields(req.db, req.tenantId, req.user.id, scopeOf(req), parseFields(req.body)));
  })
);

/** PUT /certificate-template/publish { published } — lo que pueden descargar las familias. */
router.put(
  '/publish',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // confirmActiveYear: el administrador aceptó publicar con el año escolar aún activo.
    const { published, confirmActiveYear } = z.object({ published: z.boolean(), confirmActiveYear: z.boolean().optional() }).parse(req.body);
    res.status(200).json(await service.setPublished(req.db, req.tenantId, req.user.id, scopeOf(req), published, { confirmActiveYear }));
  })
);

/** Vista previa con datos de ejemplo y las posiciones que se están editando (no guarda nada). */
router.post(
  '/preview',
  requireAdmin,
  asyncHandler(async (req, res) => {
    sendPdf(res, await service.previewPdf(req.db, req.tenantId, scopeOf(req), parseFields(req.body)));
  })
);

/** GET /certificate-template/students/:id/pdf?enrollmentId= — certificado real del alumno. */
router.get(
  '/students/:id/pdf',
  requirePermission('promotion', 'read'),
  denyTeachers,
  asyncHandler(async (req, res) => {
    const enrollmentId = req.query.enrollmentId ? uuid.parse(req.query.enrollmentId) : null;
    sendPdf(res, await service.studentPdf(req.db, req.tenantId, uuid.parse(req.params.id), { enrollmentId }));
  })
);

/** POST /certificate-template/batch { enrollmentIds } — varios certificados en un solo PDF. */
router.post(
  '/batch',
  requirePermission('promotion', 'read'),
  denyTeachers,
  asyncHandler(async (req, res) => {
    const { enrollmentIds } = z.object({ enrollmentIds: z.array(uuid).min(1, 'Elige al menos un alumno.').max(500, 'Máximo 500 certificados a la vez.') }).parse(req.body);
    sendPdf(res, await service.batchPdf(req.db, req.tenantId, enrollmentIds));
  })
);

module.exports = router;
module.exports.settleBackgroundFiles = settleBackgroundFiles;
