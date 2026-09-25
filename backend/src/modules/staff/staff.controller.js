const { z } = require('zod');
const staffService = require('./staff.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const staffSchema = z.object({
  userId: z.string().uuid().optional(),
  staffType: z.enum(['administrative', 'teaching', 'support']),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  hiredAt: z.string().optional(), // 'YYYY-MM-DD'
});

const list = asyncHandler(async (req, res) => {
  const { staffType } = req.query;
  const rows = await staffService.list(req.db, req.tenantId, { staffType });
  res.status(200).json(rows);
});

const getOne = asyncHandler(async (req, res) => {
  const row = await staffService.getById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const create = asyncHandler(async (req, res) => {
  const data = staffSchema.parse(req.body);
  const row = await staffService.create(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const update = asyncHandler(async (req, res) => {
  const data = staffSchema.partial().extend({ status: z.enum(['active', 'inactive']).optional() }).parse(req.body);
  const row = await staffService.update(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

const remove = asyncHandler(async (req, res) => {
  await staffService.remove(req.db, req.tenantId, req.params.id);
  res.status(204).send();
});

module.exports = { list, getOne, create, update, remove };
