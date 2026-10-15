const router = require('express').Router();
const controller = require('./portal.controller');
const paymentAccounts = require('../payments/paymentAccounts.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');

// Sin requirePermission: los datos se filtran por el usuario autenticado
// (igual que GET /payments/mine), así que no hace falta ningún permiso de módulo.
router.use(authMiddleware, tenantMiddleware);

router.get('/me', controller.getMyPortal);
router.get('/students/:studentId/grades', controller.getStudentGrades);
router.get('/students/:studentId/history', controller.getStudentHistory);
router.get('/students/:studentId/schedule', controller.getStudentSchedule);
router.get('/students/:studentId/sanctions', controller.getStudentSanctions);
// Cronograma de evaluaciones de la sección del alumno (solo de sus representados).
router.get('/students/:studentId/evaluations', controller.getStudentEvaluations);
// Datos de pago del colegio (activos) para reportar un pago.
router.get('/payment-accounts', paymentAccounts.listPublic);

module.exports = router;
