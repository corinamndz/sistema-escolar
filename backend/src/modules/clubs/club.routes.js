const router = require('express').Router();
const controller = require('./club.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

const can = (action) => requirePermission('clubs', action);

// Catálogo
router.get('/', can('read'), controller.list);
router.post('/', can('create'), controller.create);
router.put('/:id', can('update'), controller.update);
router.delete('/:id', can('delete'), controller.remove);

// Inscripciones (administración, o el coordinador del club: lo valida el controlador)
router.get('/students/:studentId', can('read'), controller.forStudent);
router.post('/enroll', can('read'), controller.enroll);
router.put('/memberships/:id/withdraw', can('read'), controller.withdraw);
router.get('/:id/members', can('read'), controller.members);

module.exports = router;
