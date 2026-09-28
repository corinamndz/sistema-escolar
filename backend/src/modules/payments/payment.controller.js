const { z } = require('zod');
const service = require('./payment.service');
const tuition = require('./tuition.service');
const exchange = require('./exchangeRate.service');
const { saveProof, deleteProof } = require('../../services/storage/paymentProofStorage');

/**
 * Guarda el comprobante subido (si hay) DESPUÉS de validar los campos, y deja
 * programada la limpieza para cuando termine la respuesta (la transacción del
 * tenant se confirma o revierte al final, ver tenant.middleware.js):
 *   - éxito  → se borra el comprobante anterior que haya sido reemplazado;
 *   - error  → se borra el archivo recién subido (no quedan huérfanos).
 * Devuelve { proof, setReplaced }.
 */
async function handleProofUpload(req, res) {
  const proof = req.file ? await saveProof(req.tenantId, req.file) : null;
  let replaced = null;
  res.on('finish', () => {
    if (res.statusCode < 400) deleteProof(replaced);
    else if (proof) deleteProof(proof.proof_path);
  });
  return { proof, setReplaced: (p) => { replaced = p; } };
}
const { asyncHandler } = require('../../utils/asyncHandler');

const uuidOpt = z.string().uuid().optional();

const listQuerySchema = z.object({
  studentId: uuidOpt,
  guardianId: uuidOpt,
  schoolPeriodId: uuidOpt,
  kind: z.enum(['tuition', 'other']).optional(),
  // "due" = pendiente + vencido + reportado; o estados separados por coma.
  status: z.string().regex(/^[a-z,]+$/).optional(),
});

const list = asyncHandler(async (req, res) => {
  const filters = listQuerySchema.parse(req.query);
  res.status(200).json(await service.listPayments(req.db, req.tenantId, filters));
});

const summary = asyncHandler(async (req, res) => {
  const { schoolPeriodId } = z.object({ schoolPeriodId: uuidOpt }).parse(req.query);
  res.status(200).json(await service.getSummary(req.db, req.tenantId, { schoolPeriodId }));
});

// ---- Reporte del representante / anulación ----
const reportSchema = z.object({
  method: z.enum(['transfer', 'mobile_payment', 'deposit', 'cash', 'card', 'other']),
  reference: z.string().trim().max(60).optional(),
  // "No futura" se valida en el servicio contra current_date de PostgreSQL (hora de Venezuela),
  // no con new Date() de Node, que usa UTC: de 20:00 a 24:00 en Caracas ya es "mañana" en UTC.
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.'),
  note: z.string().trim().max(300).optional(),
});

// Acepta JSON o multipart/form-data (con el archivo opcional `proof`).
const report = asyncHandler(async (req, res) => {
  const data = reportSchema.parse(req.body);
  const { proof, setReplaced } = await handleProofUpload(req, res);
  const { payment, replacedProofPath } = await service.reportPayment(req.db, req.tenantId, req.user.id, req.params.id, data, proof);
  setReplaced(replacedProofPath);
  res.status(200).json(payment);
});

/** Descarga PRIVADA del comprobante (ver service.getProof para quién puede verlo). */
const downloadProof = asyncHandler(async (req, res) => {
  const { absolutePath, mime, name } = await service.getProof(req.db, req.tenantId, req.user.id, req.params.id);
  res.set({
    'Content-Type': mime,
    // inline: se puede mostrar en el navegador; el nombre va codificado (RFC 5987).
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
  });
  res.sendFile(absolutePath);
});

const cancel = asyncHandler(async (req, res) => {
  res.status(200).json(await service.cancelPayment(req.db, req.tenantId, req.params.id));
});

// ---- Mensualidades: tarifas y generación ----
const listFees = asyncHandler(async (req, res) => {
  const { schoolPeriodId } = z.object({ schoolPeriodId: uuidOpt }).parse(req.query);
  res.status(200).json(await tuition.listFees(req.db, req.tenantId, { schoolPeriodId }));
});

const upsertFee = asyncHandler(async (req, res) => {
  const data = z
    .object({
      schoolPeriodId: z.string().uuid(),
      levelCode: z.enum(['initial', 'primary', 'secondary']).nullable().optional(),
      amount: z.number().positive('El monto debe ser mayor que 0.').max(99999999),
      // Mensualidades siempre en USD (se cobran en Bs con la tasa BCV). Se acepta "usd".
      currency: z
        .preprocess(
          (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
          z.literal('USD', { errorMap: () => ({ message: 'Las mensualidades se configuran en dólares (USD).' }) })
        )
        .optional(),
      dueDay: z.number().int().min(1).max(28).default(5),
    })
    .parse(req.body);
  res.status(200).json(await tuition.upsertFee(req.db, req.tenantId, data));
});

const deleteFee = asyncHandler(async (req, res) => {
  await tuition.deleteFee(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

const generateTuition = asyncHandler(async (req, res) => {
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid() }).parse(req.body);
  res.status(200).json(await tuition.generateTuition(req.db, req.tenantId, { schoolPeriodId }));
});

/** Vista de padres: un representante autenticado ve solo los pagos de sus propios hijos. */
const listMine = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listPaymentsForGuardianUser(req.db, req.tenantId, req.user.id));
});

const getOne = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getById(req.db, req.tenantId, req.params.id));
});

const registerSchema = z.object({
  studentId: z.string().uuid(),
  guardianId: z.string().uuid(),
  periodLabel: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1).default('USD'),
});

const register = asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const payment = await service.registerPayment(req.db, req.tenantId, data);
  res.status(201).json(payment);
});

// Datos opcionales del pago (método, referencia, fecha) que registra administración.
const markPaidSchema = z
  .object({
    method: z.enum(['transfer', 'mobile_payment', 'deposit', 'cash', 'card', 'other']).optional(),
    reference: z.string().trim().max(60).optional(),
    // "No futura" se valida en el servicio contra current_date (ver reportSchema).
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').optional(),
    note: z.string().trim().max(300).optional(),
  })
  .default({});

const markAsPaid = asyncHandler(async (req, res) => {
  const details = markPaidSchema.parse(req.body || {});
  const { proof, setReplaced } = await handleProofUpload(req, res);
  const { replacedProofPath, ...result } = await service.markAsPaid(req.db, req.tenantId, req.params.id, details, proof);
  setReplaced(replacedProofPath);
  res.status(200).json(result);
});

// ---- Tasa BCV ----
const currentRate = asyncHandler(async (req, res) => {
  res.status(200).json(await exchange.getRateStatus(req.db, req.tenantId));
});

const listRates = asyncHandler(async (req, res) => {
  res.status(200).json(await exchange.listRates(req.db, req.tenantId));
});

const upsertRate = asyncHandler(async (req, res) => {
  const data = z
    .object({
      rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.'),
      rate: z.number().positive('La tasa debe ser mayor que 0.').max(1e11),
    })
    .parse(req.body);
  res.status(200).json(await exchange.upsertRate(req.db, req.tenantId, data, req.user.id));
});

const updateRateFromBcv = asyncHandler(async (req, res) => {
  res.status(200).json(await exchange.updateFromBcv(req.db, req.tenantId, req.user.id));
});

const deleteRate = asyncHandler(async (req, res) => {
  await exchange.deleteRate(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

/** Regenera el PDF de un pago confirmado con el diseño y datos actuales. */
const regenerateReceipt = asyncHandler(async (req, res) => {
  res.status(200).json(await service.regenerateReceipt(req.db, req.tenantId, req.params.id));
});

module.exports = {
  regenerateReceipt,
  downloadProof,
  currentRate,
  listRates,
  upsertRate,
  updateRateFromBcv,
  deleteRate,
  list,
  summary,
  listMine,
  getOne,
  register,
  markAsPaid,
  report,
  cancel,
  listFees,
  upsertFee,
  deleteFee,
  generateTuition,
};
