const router = require('express').Router();
const controller = require('./programmaticContent.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

// Contenido programático: va con los permisos de planes de evaluación (lo usan
// la coordinación desde Materias y los docentes para sus materias). El docente
// solo ve y edita los grados y materias de su carga (los demás → 404).
const can = (action) => requirePermission('evaluation_plans', action);

router.use(authMiddleware, tenantMiddleware);

router.get('/options', can('read'), controller.listOptions);
router.get('/', can('read'), controller.getContent);
router.post('/', can('create'), controller.createItem);
router.put('/:id', can('update'), controller.ownItem, controller.updateItem);
router.delete('/:id', can('delete'), controller.ownItem, controller.deleteItem);

module.exports = router;
