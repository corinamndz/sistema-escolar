const { z } = require('zod');
const service = require('./payment.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { studentId, guardianId, status } = req.query;
  res.status(200).json(await service.listPayments(req.db, req.tenantId, { studentId, guardianId, status }));
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

const markAsPaid = asyncHandler(async (req, res) => {
  const result = await service.markAsPaid(req.db, req.tenantId, req.params.id);
  res.status(200).json(result);
});

module.exports = { list, listMine, getOne, register, markAsPaid };
