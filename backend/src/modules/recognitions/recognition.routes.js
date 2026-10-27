const router = require('express').Router();
const controller = require('./recognition.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

// Docente: el servicio lo limita a los alumnos de su carga y a lo que otorgó.
const can = (action) => requirePermission('recognitions', action);
router.get('/', can('read'), controller.list);
router.get('/options', can('create'), controller.options);
router.get('/:id/certificate', can('read'), controller.certificate);
router.post('/', can('create'), controller.create);
router.put('/:id', can('update'), controller.update);
router.delete('/:id', can('delete'), controller.remove);

module.exports = router;
