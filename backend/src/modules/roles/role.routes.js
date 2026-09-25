const router = require('express').Router();
const controller = require('./role.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

router.get('/modules', requirePermission('roles', 'read'), controller.listModules);

router.get('/', requirePermission('roles', 'read'), controller.list);
router.post('/', requirePermission('roles', 'create'), controller.create);
router.get('/:id', requirePermission('roles', 'read'), controller.getOne);
router.put('/:id', requirePermission('roles', 'update'), controller.rename);
router.delete('/:id', requirePermission('roles', 'delete'), controller.remove);
router.put('/:id/permissions', requirePermission('roles', 'update'), controller.setPermissions);

module.exports = router;
