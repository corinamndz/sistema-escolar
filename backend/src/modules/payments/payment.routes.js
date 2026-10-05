const router = require('express').Router();
const controller = require('./payment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { denyTeachers } = require('../access/teacherScope');
const { proofUpload } = require('../../middlewares/upload.middleware');

// Los docentes no acceden a NINGUNA ruta de pagos (ni la administración ni "Mis pagos"): 403.
router.use(authMiddleware, tenantMiddleware, denyTeachers);

// ---- Vista de padres ----
// Sin permiso administrativo de "payments": el servicio filtra por el
// representante del usuario autenticado (y valida que el pago sea suyo).
router.get('/mine', controller.listMine);
router.post('/:id/report', proofUpload, controller.report);
// Comprobante adjunto: privado; el servicio valida si quien lo pide es la familia o quien revisa pagos.
router.get('/:id/proof', controller.downloadProof);
// Recibo PDF: privado, misma regla (la familia dueña del pago o quien lee pagos).
router.get('/:id/receipt', controller.downloadReceipt);
// Cotización en otra moneda: el servicio valida si es la familia dueña o alguien que puede leer pagos.
router.get('/:id/quote', controller.quote);

// ---- Monedas y tasas (rutas fijas antes de "/:id") ----
// Las monedas activas y sus tasas vigentes son información pública para
// cualquier usuario con sesión (el representante las necesita para saber
// cuánto pagar en su moneda).
router.get('/currencies', controller.listCurrencies);
router.put('/currencies', requirePermission('payments', 'update'), controller.setCurrencies);
// Administración de monedas del colegio ("/currencies/admin" antes de "/currencies/:code").
router.get('/currencies/admin', requirePermission('payments', 'read'), controller.currencyAdmin);
router.post('/currencies', requirePermission('payments', 'update'), controller.addCurrency);
router.put('/currencies/:code', requirePermission('payments', 'update'), controller.updateCurrency);
router.delete('/currencies/:code', requirePermission('payments', 'update'), controller.removeCurrency);
router.get('/exchange-rates/current', controller.currentRate);
router.get('/exchange-rates', requirePermission('payments', 'read'), controller.listRates);
router.put('/exchange-rates', requirePermission('payments', 'update'), controller.upsertRate);
router.post('/exchange-rates/bcv', requirePermission('payments', 'update'), controller.updateRateFromBcv);
router.delete('/exchange-rates/:id', requirePermission('payments', 'update'), controller.deleteRate);

// ---- Mensualidades (rutas fijas antes de "/:id") ----
router.get('/tuition/fees', requirePermission('payments', 'read'), controller.listFees);
router.put('/tuition/fees', requirePermission('payments', 'update'), controller.upsertFee);
router.delete('/tuition/fees/:id', requirePermission('payments', 'update'), controller.deleteFee);
router.post('/tuition/generate', requirePermission('payments', 'create'), controller.generateTuition);

// ---- Administración ----
router.get('/summary', requirePermission('payments', 'read'), controller.summary);
router.get('/', requirePermission('payments', 'read'), controller.list);
router.post('/', requirePermission('payments', 'create'), controller.register);
router.get('/:id', requirePermission('payments', 'read'), controller.getOne);
router.post('/:id/mark-paid', requirePermission('payments', 'approve_payment'), proofUpload, controller.markAsPaid);
router.post('/:id/cancel', requirePermission('payments', 'update'), controller.cancel);
router.post('/:id/receipt', requirePermission('payments', 'approve_payment'), controller.regenerateReceipt);

module.exports = router;
