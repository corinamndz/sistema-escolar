const { z } = require('zod');
const service = require('./paymentBatch.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { saveProof, deleteProof } = require('../../services/storage/paymentProofStorage');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.');
const currencyCode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined),
  z.string().regex(/^[A-Z]{3}$/, 'Moneda inválida.').optional()
);
const emptyToUndefined = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
// En multipart/form-data los ids llegan como texto JSON ('["…","…"]') o separados por coma.
const paymentIds = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
}, z.array(z.string().uuid()).min(1, 'Elige al menos una cuota.').max(36, 'Como máximo 36 cuotas.'));
const methods = z.enum(['transfer', 'mobile_payment', 'deposit', 'cash', 'card', 'other']);

const quote = asyncHandler(async (req, res) => {
  const data = z.object({ paymentIds, currency: currencyCode, date: emptyToUndefined(date) }).parse(req.body || {});
  res.status(200).json(await service.quoteBatch(req.db, req.tenantId, req.user.id, data));
});

/**
 * POST /payments/batches (familia, multipart con `proof`). Obligatorios: cuotas,
 * método, fecha, referencia y comprobante (solo la nota es opcional). El
 * comprobante se guarda tras validar los campos; si la petición falla, se borra.
 */
const create = asyncHandler(async (req, res) => {
  const data = z
    .object({
      paymentIds,
      method: methods,
      reference: z.string({ required_error: 'Indica el número de referencia.' }).trim().min(1, 'Indica el número de referencia.').max(60),
      paidOn: date,
      note: emptyToUndefined(z.string().trim().max(300)),
      currency: currencyCode,
    })
    .parse(req.body || {});
  if (!req.file) throw ApiError.badRequest('Adjunta el comprobante del pago total.', [{ path: 'proof', message: 'El comprobante es obligatorio.' }]);
  const proof = await saveProof(req.tenantId, req.file);
  res.on('finish', () => res.statusCode >= 400 && proof && deleteProof(proof.proof_path));
  res.status(201).json(await service.createBatch(req.db, req.tenantId, req.user.id, data, proof));
});

const mine = asyncHandler(async (req, res) => res.status(200).json(await service.listMyBatches(req.db, req.tenantId, req.user.id)));

const withdraw = asyncHandler(async (req, res) => {
  res.status(200).json(await service.withdrawBatch(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id)));
});

const list = asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(['reported', 'approved', 'rejected', 'withdrawn', 'all']).default('reported') }).parse(req.query);
  res.status(200).json(await service.listBatches(req.db, req.tenantId, { status }));
});

const getOne = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getBatch(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id)));
});

const downloadProof = asyncHandler(async (req, res) => {
  const { absolutePath, mime, name } = await service.getBatchProof(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id));
  res.set({ 'Content-Type': mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store' });
  res.sendFile(absolutePath);
});

const approve = asyncHandler(async (req, res) => {
  const details = z
    .object({
      method: methods.optional(),
      reference: z.string().trim().max(60).optional(),
      paidOn: date.optional(),
      note: z.string().trim().max(300).optional(),
      currency: currencyCode,
    })
    .parse(req.body || {});
  res.status(200).json(await service.approveBatch(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id), details));
});

const reject = asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Indica el motivo (mínimo 5 caracteres).').max(280) }).parse(req.body || {});
  res.status(200).json(await service.rejectBatch(req.db, req.tenantId, req.user.id, z.string().uuid().parse(req.params.id), { reason: /[.!?]$/.test(reason) ? reason : `${reason}.` }));
});

module.exports = { quote, create, mine, withdraw, list, getOne, downloadProof, approve, reject };
