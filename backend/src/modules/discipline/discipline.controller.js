const { z } = require('zod');
const service = require('./discipline.service');
const teacherScope = require('../access/teacherScope');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');

const sanctionSchema = z.object({
  severity: z.enum(['leve', 'grave', 'gravisima'], { errorMap: () => ({ message: 'Elige la gravedad: leve, grave o gravísima.' }) }),
  faultType: z.string().trim().min(1, 'Indica el tipo de falta.').max(120),
  description: z.string().trim().min(1, 'Describe el motivo de la sanción.').max(2000),
  measure: z.string().trim().max(200).optional().nullable(),
  occurredOn: date,
  schoolPeriodId: uuid.optional(),
  termNumber: z.coerce.number().int().min(1).max(3).optional(),
});

/** GET /discipline/sanctions?schoolPeriodId=&severity=&q= — docente: solo alumnos de su carga. */
const list = asyncHandler(async (req, res) => {
  const q = z
    .object({ schoolPeriodId: uuid.optional(), severity: z.enum(['leve', 'grave', 'gravisima']).optional(), studentId: uuid.optional(), q: z.string().max(100).optional() })
    .parse(req.query);
  const scope = await teacherScope.getTeacherScope(req);
  res.status(200).json(await service.listSanctions(req.db, req.tenantId, { ...q, scope }));
});

/** GET /discipline/students/:studentId/sanctions — historial del alumno. */
const studentHistory = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getStudentSanctions(req.db, req.tenantId, uuid.parse(req.params.studentId)));
});

/** POST /discipline/students/:studentId/sanctions */
const create = asyncHandler(async (req, res) => {
  const data = sanctionSchema.parse(req.body);
  res.status(201).json(await service.createSanction(req.db, req.tenantId, req.user.id, uuid.parse(req.params.studentId), data));
});

/** PUT /discipline/sanctions/:id */
const update = asyncHandler(async (req, res) => {
  const data = sanctionSchema.partial().parse(req.body);
  res.status(200).json(await service.updateSanction(req.db, req.tenantId, req.user.id, uuid.parse(req.params.id), data));
});

/** DELETE /discipline/sanctions/:id */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteSanction(req.db, req.tenantId, uuid.parse(req.params.id)));
});

module.exports = { list, studentHistory, create, update, remove };
