const router = require('express').Router();
const controller = require('./appointment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const teacherScope = require('../access/teacherScope');

router.use(authMiddleware, tenantMiddleware);

const can = (action) => requirePermission('appointments', action);
// Agendar, editar y eliminar es de la administración y la directiva (el docente solo consulta).
const manage = (action) => [can(action), teacherScope.denyTeachers];

router.get('/', can('read'), controller.list);
router.get('/options', ...manage('create'), controller.options);
router.get('/:id', can('read'), controller.get);
router.post('/', ...manage('create'), controller.create);
router.put('/:id', ...manage('update'), controller.update);
router.delete('/:id', ...manage('delete'), controller.remove);

module.exports = router;
