const { z } = require('zod');
const service = require('./appointment.service');
const teacherScope = require('../access/teacherScope');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const optionalText = (max) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

const fields = z.object({
  guardianId: uuid,
  studentId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  meetingDate: day,
  startTime: z.string({ required_error: 'Indica la hora de la cita.' }).regex(HHMM, 'Hora inválida (HH:MM).'),
  endTime: z.preprocess((v) => (v === '' ? null : v), z.string().regex(HHMM, 'Hora inválida (HH:MM).').nullable().optional()),
  location: optionalText(150),
  topic: z.string().trim().min(1, 'Escribe el motivo de la cita.').max(200),
  notes: optionalText(2000),
  status: z.enum(service.STATUSES).optional(),
  notifyBell: z.boolean(),
  notifyEmail: z.boolean(),
});
const timeOrder = (d, ctx) => {
  if (d.startTime && d.endTime && d.endTime <= d.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La hora de fin debe ser posterior a la de inicio.', path: ['endTime'] });
  }
};
const createSchema = fields.superRefine(timeOrder);
const updateSchema = fields.partial().superRefine(timeOrder);

const listQuery = (req) =>
  z
    .object({ from: day.optional(), to: day.optional(), status: z.enum(service.STATUSES).optional() })
    .parse({ from: req.query.from || undefined, to: req.query.to || undefined, status: req.query.status || undefined });

/** Docente con carga restringida: solo citas de alumnos de su carga (y solo consulta). */
const scopeOf = (req) => teacherScope.getTeacherScope(req);

/** GET /appointments?from=&to=&status= */
const list = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listAppointments(req.db, req.tenantId, { ...listQuery(req), scope: await scopeOf(req) }));
});

/** GET /appointments/options — representantes con sus alumnos, canales predeterminados y si el correo está listo. */
const options = asyncHandler(async (req, res) => {
  res.status(200).json(await service.formOptions(req.db, req.tenantId));
});

/** GET /appointments/:id */
const get = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getAppointment(req.db, req.tenantId, uuid.parse(req.params.id), await scopeOf(req)));
});

/** POST /appointments */
const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createAppointment(req.db, req.tenantId, req.user.id, createSchema.parse(req.body)));
});

/** PUT /appointments/:id (parcial) */
const update = asyncHandler(async (req, res) => {
  res.status(200).json(await service.updateAppointment(req.db, req.tenantId, uuid.parse(req.params.id), updateSchema.parse(req.body)));
});

/** DELETE /appointments/:id */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteAppointment(req.db, req.tenantId, uuid.parse(req.params.id)));
});

module.exports = { list, options, get, create, update, remove };
