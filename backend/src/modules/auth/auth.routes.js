const router = require('express').Router();
const controller = require('./auth.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

// Públicas: todavía no hay tenant activo en la sesión de base de datos.
router.post('/login', controller.login);
router.post('/refresh', controller.refresh);
// Recuperación de contraseña: el colegio va en el cuerpo (tenantSlug), como en el login.
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password/verify', controller.verifyResetToken);
router.post('/reset-password', controller.resetPassword);

// Protegidas: requieren usuario autenticado + tenant resuelto.
router.get('/me', authMiddleware, tenantMiddleware, controller.me);
router.post('/change-password', authMiddleware, tenantMiddleware, controller.changePassword);

// Alta de usuarios: se administra junto con Roles (crear un usuario implica
// asignarle rol(es) de una vez).
router.post(
  '/users',
  authMiddleware,
  tenantMiddleware,
  requirePermission('roles', 'create'),
  controller.createUser
);

module.exports = router;
