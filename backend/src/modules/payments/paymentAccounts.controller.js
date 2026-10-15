const { z } = require('zod');
const service = require('./paymentAccounts.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const text = (max) => z.string().trim().max(max);
const optionalText = (max) => z.preprocess((v) => (v === '' ? null : v), text(max).nullable().optional());

const accountSchema = z.object({
  method: z.enum(['mobile_payment', 'transfer'], { errorMap: () => ({ message: 'Elige el tipo: pago móvil o transferencia.' }) }),
  bankCode: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}$/, 'El código de banco tiene 4 dígitos (ej. 0102).').nullable().optional()),
  bankName: text(80).min(1, 'Indica el banco.'),
  holderName: optionalText(120),
  holderId: text(20).min(1, 'Indica la cédula o el RIF del titular.'),
  phone: optionalText(20),
  accountNumber: optionalText(40),
  accountType: z.preprocess((v) => (v === '' ? null : v), z.enum(['checking', 'savings']).nullable().optional()),
  notes: optionalText(200),
  isActive: z.boolean().optional(),
});

const id = () => z.string().uuid();

/** GET /tenant/payment-accounts — datos de pago del colegio (administración). */
const list = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listAccounts(req.db, req.tenantId));
});

/** POST /tenant/payment-accounts */
const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createAccount(req.db, req.tenantId, accountSchema.parse(req.body)));
});

/** PUT /tenant/payment-accounts/:id (parcial) */
const update = asyncHandler(async (req, res) => {
  res.status(200).json(await service.updateAccount(req.db, req.tenantId, id().parse(req.params.id), accountSchema.partial().parse(req.body)));
});

/** DELETE /tenant/payment-accounts/:id */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteAccount(req.db, req.tenantId, id().parse(req.params.id)));
});

/** GET /portal/payment-accounts — las activas, para el representante que reporta un pago. */
const listPublic = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listPublicAccounts(req.db, req.tenantId));
});

module.exports = { list, create, update, remove, listPublic };
