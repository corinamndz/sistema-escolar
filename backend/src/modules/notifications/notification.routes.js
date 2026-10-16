const router = require('express').Router();
const { z } = require('zod');
const service = require('./notification.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');

// Sin requirePermission: cada usuario ve solo las notificaciones de su público
// (administración de pagos y/o representante); el servicio lo filtra.
router.use(authMiddleware, tenantMiddleware);

router.get('/', asyncHandler(async (req, res) => res.status(200).json(await service.listForUser(req.db, req.tenantId, req.user.id))));
router.post('/read-all', asyncHandler(async (req, res) => res.status(200).json(await service.markAllRead(req.db, req.tenantId, req.user.id))));
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => res.status(200).json(await service.markRead(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id))))
);

module.exports = router;
