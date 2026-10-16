const router = require('express').Router();
const controller = require('./payment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { denyTeachers } = require('../access/teacherScope');

// Tasa oficial del BCV. Mismos permisos que las rutas equivalentes de /payments/exchange-rates.
router.use(authMiddleware, tenantMiddleware, denyTeachers);

// Tasas vigentes (+ estado de la sincronización para quien administra pagos).
router.get('/current', controller.currentRate);
// Forzar la consulta al BCV ahora ("Actualizar tasa ahora").
router.post('/sync', requirePermission('payments', 'update'), controller.updateRateFromBcv);
// Pruebas de la campana: aviso de una tasa simulada (no se registra la tasa) y limpieza.
router.post('/simulate', requirePermission('payments', 'update'), controller.simulateBcvRate);
router.delete('/simulate', requirePermission('payments', 'update'), controller.clearBcvSimulations);

module.exports = router;
