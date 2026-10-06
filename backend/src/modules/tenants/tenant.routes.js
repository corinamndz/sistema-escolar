const router = require('express').Router();
const controller = require('./tenant.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { logoUpload } = require('../../middlewares/upload.middleware');

router.use(authMiddleware, tenantMiddleware);

// Nombre, logo, colores y contacto: lo necesita todo usuario con sesión (diseño, pie de página).
router.get('/profile', controller.getProfile);
router.get('/settings', requirePermission('tenant_settings', 'read'), controller.getSettings);
// El permiso se verifica antes de leer el archivo: un usuario sin permiso no llega a subir nada.
router.put('/settings', requirePermission('tenant_settings', 'update'), logoUpload, controller.updateSettings);

module.exports = router;
