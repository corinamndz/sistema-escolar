const router = require('express').Router();
const { z } = require('zod');
const service = require('./notification.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const teacherScope = require('../access/teacherScope');
const log = require('./notificationLog.service');
const announcements = require('./announcement.service');
const { announcementImageUpload } = require('../../middlewares/upload.middleware');
const { saveAnnouncementImage } = require('../../services/storage/announcementImageStorage');
const { ApiError } = require('../../utils/ApiError');

// Sin requirePermission: cada usuario ve solo las notificaciones de su público
// (administración de pagos y/o representante); el servicio lo filtra.
router.use(authMiddleware, tenantMiddleware);

// Log de notificaciones (Administración): historial de envíos y reenvío individual.
router.get(
  '/log',
  requirePermission('tenant_settings', 'read'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => {
    // `days`: últimos N días (por defecto 90) o 'all'.
    const days = req.query.days === 'all' ? null : z.coerce.number().int().min(1).max(3650).default(90).parse(req.query.days || undefined);
    res.status(200).json(await log.listLog(req.db, req.tenantId, { days }));
  })
);
router.post(
  '/log/:source/:id/resend',
  requirePermission('tenant_settings', 'update'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => {
    const source = z.enum(log.SOURCES).parse(req.params.source);
    const id = z.string().uuid().parse(req.params.id);
    res.status(200).json(await log.resend(req.db, req.tenantId, { source, id, userId: req.user.id }));
  })
);

// ---- Comunicados de la administración (migración 076): módulo «Comunicados» ----
const uuidList = z.array(z.string().uuid()).max(2000).default([]);
const scopeSchema = z.object({
  scope: z.enum(['school', 'levels', 'grades', 'sections', 'people'], { errorMap: () => ({ message: 'Alcance inválido.' }) }),
  levelCodes: z.array(z.enum(['initial', 'primary', 'secondary'])).max(3).default([]),
  gradeIds: uuidList,
  sectionIds: uuidList,
  guardianIds: uuidList,
  staffIds: uuidList,
  groups: z.object({ guardians: z.boolean().default(false), teachers: z.boolean().default(false), staff: z.boolean().default(false) }).default({}),
});
const broadcastSchema = scopeSchema.extend({
  title: z.string().trim().min(3, 'Escribe el asunto (mínimo 3 caracteres).').max(150, 'Máximo 150 caracteres.'),
  category: z.enum(['academic', 'administrative', 'urgent', 'event'], { errorMap: () => ({ message: 'Elige la categoría.' }) }),
  html: z.string().max(120000, 'El mensaje es demasiado largo.'),
});
const senderOf = async (req) => {
  const u = await req.db('users').where({ id: req.user.id }).first('full_name');
  return { id: req.user.id, name: u?.full_name || null };
};
router.get(
  '/broadcast/options',
  requirePermission('announcements', 'create'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => res.status(200).json(await announcements.options(req.db, req.tenantId)))
);
router.post(
  '/broadcast/preview',
  requirePermission('announcements', 'create'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => res.status(200).json(await announcements.preview(req.db, req.tenantId, req.user.id, scopeSchema.parse(req.body))))
);
/** POST /notifications/broadcast — { title, category, html, scope, levelCodes?, gradeIds?, sectionIds?, guardianIds?, staffIds?, groups } */
router.post(
  '/broadcast',
  requirePermission('announcements', 'create'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => res.status(201).json(await announcements.send(req.db, req.tenantId, await senderOf(req), broadcastSchema.parse(req.body))))
);
/** POST /notifications/broadcast/images (multipart, campo `image`) → { url } para insertar en el mensaje. */
router.post(
  '/broadcast/images',
  requirePermission('announcements', 'create'),
  teacherScope.denyTeachers,
  announcementImageUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Elige una imagen.', [{ path: 'image', message: 'Requerido.' }]);
    res.status(201).json({ url: await saveAnnouncementImage(req.tenantId, req.file.buffer) });
  })
);
router.get(
  '/broadcast',
  requirePermission('announcements', 'read'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => res.status(200).json(await announcements.listSent(req.db, req.tenantId)))
);

// Conteo de no leídas (aviso al iniciar sesión): más liviano que la lista completa.
router.get('/unread-count', asyncHandler(async (req, res) => res.status(200).json(await service.unreadSummary(req.db, req.tenantId, req.user.id))));
router.get('/', asyncHandler(async (req, res) => res.status(200).json(await service.listForUser(req.db, req.tenantId, req.user.id))));

// Centro de notificaciones: historial completo del usuario, paginado y filtrado.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).').optional();
const historySchema = z
  .object({
    status: z.enum(['all', 'unread', 'read']).default('all'),
    from: day,
    to: day,
    type: z.string().trim().max(30).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(5).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['to'], message: 'La fecha final debe ser igual o posterior a la inicial.' });
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    // Vacíos ("") como ausentes: así llegan los filtros sin valor desde el formulario.
    const query = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== ''));
    res.status(200).json(await service.history(req.db, req.tenantId, req.user.id, historySchema.parse(query)));
  })
);
router.post('/read-all', asyncHandler(async (req, res) => res.status(200).json(await service.markAllRead(req.db, req.tenantId, req.user.id))));
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => res.status(200).json(await service.markRead(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id))))
);

// Trazabilidad de lectura de un aviso (a quién se envió, quién lo leyó y cuándo):
// mismo acceso que el Log de notificaciones (Administración, sin docentes).
router.get(
  '/:id/audit',
  requirePermission('tenant_settings', 'read'),
  teacherScope.denyTeachers,
  asyncHandler(async (req, res) => res.status(200).json(await service.readAudit(req.db, req.tenantId, z.string().uuid().parse(req.params.id))))
);

module.exports = router;
