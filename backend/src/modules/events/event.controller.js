const { z } = require('zod');
const service = require('./event.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();
const optionalText = (max) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const optionalTime = z.preprocess((v) => (v === '' ? null : v), z.string().regex(hhmm, 'Hora inválida (HH:MM).').nullable().optional());

const eventFields = z.object({
  title: z.string().trim().min(1, 'Escribe el título del evento.').max(150),
  category: z.enum(service.CATEGORIES).optional(),
  description: optionalText(4000),
  location: optionalText(150),
  audience: z.enum(service.AUDIENCES).optional(),
  gradeId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  sectionId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  isPublished: z.boolean().optional(),
  // Una sola fecha por evento, con su hora de inicio y (opcional) de fin.
  eventDate: day,
  startTime: z.string({ required_error: 'Indica la hora de inicio.' }).regex(hhmm, 'Hora inválida (HH:MM).'),
  endTime: optionalTime,
});
const timeOrder = (d, ctx) => {
  if (d.startTime && d.endTime && d.endTime <= d.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La hora de fin debe ser posterior a la de inicio.', path: ['endTime'] });
  }
};
const createSchema = eventFields.superRefine(timeOrder);
// Edición parcial: el servicio vuelve a validar el horario contra lo guardado.
const updateSchema = eventFields.partial().superRefine(timeOrder);

const rangeQuery = (req) =>
  z
    .object({ from: day.optional(), to: day.optional(), category: z.enum(service.CATEGORIES).optional() })
    .parse({ from: req.query.from || undefined, to: req.query.to || undefined, category: req.query.category || undefined });

/** GET /events?from=&to=&category= — administración (incluye borradores). */
const list = asyncHandler(async (req, res) => {
  res.status(200).json(await service.listEvents(req.db, req.tenantId, rangeQuery(req)));
});

/** GET /events/audiences — grados y secciones (años activos) para el destino. */
const audiences = asyncHandler(async (req, res) => {
  res.status(200).json(await service.audienceOptions(req.db, req.tenantId));
});

/** GET /events/:id */
const get = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getEvent(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** POST /events */
const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createEvent(req.db, req.tenantId, req.user.id, createSchema.parse(req.body)));
});

/** PUT /events/:id (parcial) */
const update = asyncHandler(async (req, res) => {
  res.status(200).json(await service.updateEvent(req.db, req.tenantId, uuid.parse(req.params.id), updateSchema.parse(req.body)));
});

/** DELETE /events/:id */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteEvent(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** GET /portal/events?from= — cartelera del representante (filtrada por sus hijos). */
const portalList = asyncHandler(async (req, res) => {
  const { from } = rangeQuery(req);
  res.status(200).json(await service.portalEvents(req.db, req.tenantId, req.user.id, { from }));
});

module.exports = { list, audiences, get, create, update, remove, portalList };
