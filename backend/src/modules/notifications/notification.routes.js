const router = require('express').Router();
const { z } = require('zod');
const service = require('./notification.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const teacherScope = require('../access/teacherScope');
const log = require('./notificationLog.service');

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
