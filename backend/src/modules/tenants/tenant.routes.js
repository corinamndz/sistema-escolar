const router = require('express').Router();
const controller = require('./tenant.controller');
const paymentAccounts = require('../payments/paymentAccounts.controller');
const mailSettings = require('./mailSettings.controller');
const notificationPrefs = require('../notifications/notificationPreferences.controller');
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

// Escala de calificación de cada grado (cuantitativa 0-20 o cualitativa A-E).
router.get('/grading-scales', requirePermission('tenant_settings', 'read'), controller.getGradingScales);
router.put('/grading-scales', requirePermission('tenant_settings', 'update'), controller.updateGradingScales);

// Datos de pago del colegio (pago móvil y cuentas bancarias) que ven los representantes al reportar.
router.get('/payment-accounts', requirePermission('tenant_settings', 'read'), paymentAccounts.list);
router.post('/payment-accounts', requirePermission('tenant_settings', 'update'), paymentAccounts.create);
router.put('/payment-accounts/:id', requirePermission('tenant_settings', 'update'), paymentAccounts.update);
router.delete('/payment-accounts/:id', requirePermission('tenant_settings', 'update'), paymentAccounts.remove);

// Correo del colegio (SMTP propio: Gmail o corporativo). La contraseña nunca se devuelve.
router.get('/mail-settings', requirePermission('tenant_settings', 'read'), mailSettings.get);
router.put('/mail-settings', requirePermission('tenant_settings', 'update'), mailSettings.save);
router.delete('/mail-settings', requirePermission('tenant_settings', 'update'), mailSettings.remove);
router.post('/mail-settings/test', requirePermission('tenant_settings', 'update'), mailSettings.test);
// «Conectar con Google» (OAuth2, permiso gmail.send). El regreso desde Google está en /api/integrations.
router.post('/mail-settings/google/connect', requirePermission('tenant_settings', 'update'), mailSettings.googleConnect);
router.put('/mail-settings/google', requirePermission('tenant_settings', 'update'), mailSettings.googleUpdate);
router.delete('/mail-settings/google', requirePermission('tenant_settings', 'update'), mailSettings.googleDisconnect);
router.post('/mail-settings/google/test', requirePermission('tenant_settings', 'update'), mailSettings.googleTest);

// Qué avisos salen por la campana y cuáles por correo (Configuración → Notificaciones).
router.get('/notification-preferences', requirePermission('tenant_settings', 'read'), notificationPrefs.get);
router.put('/notification-preferences', requirePermission('tenant_settings', 'update'), notificationPrefs.save);

module.exports = router;
