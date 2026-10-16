const router = require('express').Router();
const controller = require('./event.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

const can = (action) => requirePermission('events', action);

// Cartelera de eventos (administración). El portal usa GET /portal/events.
router.get('/', can('read'), controller.list);
router.get('/audiences', can('read'), controller.audiences);
router.get('/:id', can('read'), controller.get);
router.post('/', can('create'), controller.create);
router.put('/:id', can('update'), controller.update);
router.delete('/:id', can('delete'), controller.remove);

module.exports = router;
