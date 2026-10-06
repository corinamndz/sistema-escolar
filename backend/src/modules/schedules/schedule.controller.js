const { z } = require('zod');
const service = require('./schedule.service');
const academicService = require('../academics/academic.service');
const teacherScope = require('../access/teacherScope');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');

const uuid = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM).');

/** GET /schedules/periods/:periodId/slots */
const listSlots = asyncHandler(async (req, res) => {
  const period = await service.loadPeriod(req.db, req.tenantId, uuid.parse(req.params.periodId));
  res.status(200).json(await service.listSlots(req.db, req.tenantId, period.id));
});

/** PUT /schedules/periods/:periodId/slots — { slots: [{ id?, name, startTime, endTime, isBreak? }] } */
const saveSlots = asyncHandler(async (req, res) => {
  const { slots } = z
    .object({
      slots: z
        .array(z.object({ id: uuid.optional(), name: z.string().trim().min(1, 'Ponle nombre al bloque.').max(40), startTime: time, endTime: time, isBreak: z.boolean().optional() }))
        .max(20),
    })
    .parse(req.body);
  res.status(200).json(await service.saveSlots(req.db, req.tenantId, uuid.parse(req.params.periodId), slots));
});

/** GET /schedules/sections — secciones para elegir (administración). */
const listSections = asyncHandler(async (req, res) => {
  res.status(200).json(await academicService.listSections(req.db, req.tenantId, { schoolPeriodId: req.query.schoolPeriodId }));
});

/**
 * GET /schedules/sections/:id
 *   - Docente (restringido a su carga): solo SUS secciones, solo lectura.
 *   - Con permiso "schedules": cualquier sección; editable si puede editar.
 */
const getSectionSchedule = asyncHandler(async (req, res) => {
  const sectionId = uuid.parse(req.params.id);
  const scope = await teacherScope.getTeacherScope(req);
  if (scope) {
    await teacherScope.assertSectionAccess(req, sectionId);
    return res.status(200).json(await service.getSectionSchedule(req.db, req.tenantId, sectionId, { editable: false }));
  }
  const perms = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
  if (!perms.schedules?.can_read) throw ApiError.forbidden('No tienes permiso de "read" sobre "schedules".');
  return res.status(200).json(await service.getSectionSchedule(req.db, req.tenantId, sectionId, { editable: Boolean(perms.schedules.can_update) }));
});

const cellSchema = z.object({ dayOfWeek: z.coerce.number().int().min(1).max(5), timeSlotId: uuid });

/** POST /schedules/sections/:id/entries — { subjectId, dayOfWeek, timeSlotId } (arrastrar una materia a una celda). */
const placeEntry = asyncHandler(async (req, res) => {
  const data = cellSchema.extend({ subjectId: uuid }).parse(req.body);
  res.status(201).json(await service.placeEntry(req.db, req.tenantId, uuid.parse(req.params.id), data));
});

/** PUT /schedules/entries/:id — { dayOfWeek, timeSlotId } (mover una clase). */
const moveEntry = asyncHandler(async (req, res) => {
  res.status(200).json(await service.moveEntry(req.db, req.tenantId, uuid.parse(req.params.id), cellSchema.parse(req.body)));
});

/** DELETE /schedules/entries/:id */
const removeEntry = asyncHandler(async (req, res) => {
  res.status(200).json(await service.removeEntry(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** GET /schedules/mine — horario semanal del docente autenticado (solo lectura). */
const mySchedule = asyncHandler(async (req, res) => {
  const staff = await req.db('staff').where({ tenant_id: req.tenantId, user_id: req.user.id }).select('id').first();
  if (!staff) throw ApiError.notFound('Tu usuario no está vinculado a una ficha de personal docente.');
  res.status(200).json(await service.getTeacherSchedule(req.db, req.tenantId, staff.id));
});

module.exports = { listSlots, saveSlots, listSections, getSectionSchedule, placeEntry, moveEntry, removeEntry, mySchedule };
