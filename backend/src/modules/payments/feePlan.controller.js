const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const service = require('./feePlan.service');

/** Tarifa especial: porcentaje de descuento (0–100] o monto fijo mensual en USD. */
const planSchema = z
  .object({
    name: z.string().trim().min(2, 'Escribe un nombre (ej. Beca 50 %).').max(80, 'Máximo 80 caracteres.'),
    kind: z.enum(['percentage', 'fixed'], { errorMap: () => ({ message: 'Elige el tipo: porcentaje o monto fijo.' }) }),
    percentage: z.number().nullable().optional(),
    amount: z.number().nullable().optional(),
    description: z.string().trim().max(300, 'Máximo 300 caracteres.').nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'percentage' && !(d.percentage > 0 && d.percentage <= 100)) {
      ctx.addIssue({ code: 'custom', path: ['percentage'], message: 'El porcentaje debe ser mayor que 0 y hasta 100.' });
    }
    if (d.kind === 'fixed' && !(d.amount > 0 && d.amount <= 99999999)) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'El monto debe ser mayor que 0.' });
    }
  });

const id = (req) => z.string().uuid('Identificador inválido.').parse(req.params.id);

const list = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listFeePlans(req.db, req.tenantId));
});

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createFeePlan(req.db, req.tenantId, planSchema.parse(req.body)));
});

const update = asyncHandler(async (req, res) => {
  res.status(200).json(await service.updateFeePlan(req.db, req.tenantId, id(req), planSchema.parse(req.body)));
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteFeePlan(req.db, req.tenantId, id(req));
  res.status(204).send();
});

const studentFee = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getStudentFee(req.db, req.tenantId, id(req)));
});

/** { feePlanId: uuid | null (tarifa general del nivel), note?: motivo (convenio, acta de beca…) } */
const assignStudentFee = asyncHandler(async (req, res) => {
  const data = z
    .object({
      feePlanId: z.string().uuid('Tarifa inválida.').nullable(),
      note: z.string().trim().max(200, 'Máximo 200 caracteres.').nullable().optional(),
    })
    .parse(req.body);
  res.status(200).json(await service.assignStudentFeePlan(req.db, req.tenantId, id(req), data));
});

module.exports = { list, create, update, remove, studentFee, assignStudentFee };
