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

// Usuario de acceso del empleado. Crear/gestionar exige ADEMÁS permiso para editar
// roles: asignar un rol es otorgar permisos (evita escalar privilegios desde Personal).
const manageAccess = [requirePermission('staff', 'update'), requirePermission('roles', 'update')];
router.get('/:id/access', requirePermission('staff', 'read'), controller.getAccess);
router.post('/:id/access', ...manageAccess, controller.createAccess);
router.put('/:id/access', ...manageAccess, controller.updateAccess);

module.exports = router;
