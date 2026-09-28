const router = require('express').Router();
const controller = require('./payment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { proofUpload } = require('../../middlewares/upload.middleware');

router.use(authMiddleware, tenantMiddleware);

// ---- Vista de padres ----
// Sin permiso administrativo de "payments": el servicio filtra por el
// representante del usuario autenticado (y valida que el pago sea suyo).
router.get('/mine', controller.listMine);
router.post('/:id/report', proofUpload, controller.report);
// Comprobante adjunto: privado; el servicio valida si quien lo pide es la familia o quien revisa pagos.
router.get('/:id/proof', controller.downloadProof);

// ---- Tasa BCV (rutas fijas antes de "/:id") ----
// La tasa vigente es información pública: la ve cualquier usuario con sesión
// (el representante la necesita para saber cuánto pagar en Bs).
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
