const { z } = require('zod');
const service = require('./student.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const studentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.string().optional(),
  nationalId: z.string().optional(),
});

const guardianSchema = z.object({
  userId: z.string().uuid().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

const linkSchema = z.object({
  guardianId: z.string().uuid(),
  relationship: z.string().min(1),
  isPrimary: z.boolean().default(false),
});

// ---- Alumnos ----

const listStudents = asyncHandler(async (req, res) => {
  const rows = await service.listStudents(req.db, req.tenantId, { status: req.query.status });
  res.status(200).json(rows);
});

const getStudent = asyncHandler(async (req, res) => {
  const row = await service.getStudentById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const createStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.parse(req.body);
  const row = await service.createStudent(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const updateStudent = asyncHandler(async (req, res) => {
  const data = studentSchema.partial().extend({ status: z.enum(['active', 'inactive', 'graduated', 'withdrawn']).optional() }).parse(req.body);
  const row = await service.updateStudent(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

// ---- Representantes ----

const listGuardians = asyncHandler(async (req, res) => {
  const rows = await service.listGuardians(req.db, req.tenantId);
  res.status(200).json(rows);
});

const getGuardian = asyncHandler(async (req, res) => {
  const row = await service.getGuardianById(req.db, req.tenantId, req.params.id);
  res.status(200).json(row);
});

const createGuardian = asyncHandler(async (req, res) => {
  const data = guardianSchema.parse(req.body);
  const row = await service.createGuardian(req.db, req.tenantId, data);
  res.status(201).json(row);
});

const updateGuardian = asyncHandler(async (req, res) => {
  const data = guardianSchema.partial().parse(req.body);
  const row = await service.updateGuardian(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

// ---- Asociación ----

const linkGuardian = asyncHandler(async (req, res) => {
  const data = linkSchema.parse(req.body);
  const row = await service.linkGuardian(req.db, req.tenantId, req.params.id, data);
  res.status(200).json(row);
});

const unlinkGuardian = asyncHandler(async (req, res) => {
  await service.unlinkGuardian(req.db, req.tenantId, req.params.id, req.params.guardianId);
  res.status(204).send();
});

module.exports = {
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  listGuardians,
  getGuardian,
  createGuardian,
  updateGuardian,
  linkGuardian,
  unlinkGuardian,
};
