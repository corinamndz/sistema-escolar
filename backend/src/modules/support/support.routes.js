const router = require('express').Router();
const controller = require('./support.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requireAdmin } = require('../../middlewares/admin.middleware');
const { supportUpload } = require('../../middlewares/upload.middleware');

// Soporte técnico: SOLO el Administrador del colegio (cualquier otro rol → 403).
router.use(authMiddleware, tenantMiddleware, requireAdmin);

router.get('/options', controller.options);
router.get('/tickets', controller.list);
router.post('/tickets', supportUpload, controller.create);
router.get('/tickets/:id', controller.getOne);
router.post('/tickets/:id/messages', controller.reply);
router.get('/tickets/:id/attachment', controller.attachment);

module.exports = router;
