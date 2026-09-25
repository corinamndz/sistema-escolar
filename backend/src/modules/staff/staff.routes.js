const router = require('express').Router();
const controller = require('./staff.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

router.get('/', requirePermission('staff', 'read'), controller.list);
router.post('/', requirePermission('staff', 'create'), controller.create);
router.get('/:id', requirePermission('staff', 'read'), controller.getOne);
router.put('/:id', requirePermission('staff', 'update'), controller.update);
router.delete('/:id', requirePermission('staff', 'delete'), controller.remove);

module.exports = router;
