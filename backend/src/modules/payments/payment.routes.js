const router = require('express').Router();
const controller = require('./payment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

// Vista de padres (no requiere permiso administrativo de "payments": cualquier
// usuario autenticado que sea representante puede ver los pagos de sus hijos).
router.get('/mine', controller.listMine);

router.get('/', requirePermission('payments', 'read'), controller.list);
router.post('/', requirePermission('payments', 'create'), controller.register);
router.get('/:id', requirePermission('payments', 'read'), controller.getOne);
router.post('/:id/mark-paid', requirePermission('payments', 'approve_payment'), controller.markAsPaid);

module.exports = router;
