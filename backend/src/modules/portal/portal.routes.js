const router = require('express').Router();
const controller = require('./portal.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');

// Sin requirePermission: los datos se filtran por el usuario autenticado
// (igual que GET /payments/mine), así que no hace falta ningún permiso de módulo.
router.use(authMiddleware, tenantMiddleware);

router.get('/me', controller.getMyPortal);
router.get('/students/:studentId/grades', controller.getStudentGrades);
router.get('/students/:studentId/history', controller.getStudentHistory);

module.exports = router;
