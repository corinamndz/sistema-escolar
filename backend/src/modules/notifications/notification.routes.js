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

router.get('/', asyncHandler(async (req, res) => res.status(200).json(await service.listForUser(req.db, req.tenantId, req.user.id))));
router.post('/read-all', asyncHandler(async (req, res) => res.status(200).json(await service.markAllRead(req.db, req.tenantId, req.user.id))));
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => res.status(200).json(await service.markRead(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id))))
);

module.exports = router;
