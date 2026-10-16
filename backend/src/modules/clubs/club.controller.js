const { z } = require('zod');
const service = require('./club.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

const uuid = z.string().uuid();
const optionalText = (max) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

const clubSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre del club.').max(100),
  category: z.enum(service.CATEGORIES).optional(),
  description: optionalText(500),
  isCustom: z.boolean().optional(),
  coordinatorId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable().optional()),
  scheduleText: optionalText(120),
  capacity: z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().positive('El cupo debe ser mayor que 0.').max(1000).nullable().optional()),
  isActive: z.boolean().optional(),
  // Fechas concretas de las sesiones (selector múltiple) y hora común opcional.
  sessionDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.')).max(366, 'Máximo 366 fechas.').optional(),
  startTime: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM).').nullable().optional()),
  endTime: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM).').nullable().optional()),
}).refine((d) => !d.startTime || !d.endTime || d.endTime > d.startTime, { message: 'La hora de fin debe ser posterior a la de inicio.', path: ['endTime'] });

/**
 * ¿Puede inscribir/retirar en este club? Con permiso de edición del módulo,
 * o si es el COORDINADOR del club (un docente gestiona su propio club).
 */
async function assertCanManage(req, clubId) {
  const perms = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
  if (perms.clubs?.can_update || perms.clubs?.can_create) return;
  if (clubId) {
    const club = await service.loadClub(req.db, req.tenantId, clubId);
    const staff = await req.db('staff').where({ tenant_id: req.tenantId, user_id: req.user.id }).select('id').first();
    if (staff && club.coordinator_id === staff.id) return;
  }
  throw ApiError.forbidden('Solo la administración o el coordinador del club pueden inscribir o retirar alumnos.');
}

/** GET /clubs?school_period_id=&active_only= */
const list = asyncHandler(async (req, res) => {
  const q = z
    .object({ schoolPeriodId: uuid.optional(), activeOnly: z.enum(['true', 'false']).optional() })
    .parse({ schoolPeriodId: req.query.school_period_id || req.query.schoolPeriodId || undefined, activeOnly: req.query.active_only });
  res.status(200).json(await service.listClubs(req.db, req.tenantId, { schoolPeriodId: q.schoolPeriodId, activeOnly: q.activeOnly === 'true' }));
});

/** POST /clubs — también para la opción "OTRO" (isCustom: true). */
const create = asyncHandler(async (req, res) => {
  const club = await service.createClub(req.db, req.tenantId, clubSchema.parse(req.body));
  res.status(201).json(await service.clubWithSessions(req.db, req.tenantId, club.id));
});

/** PUT /clubs/:id (parcial) */
const update = asyncHandler(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await service.updateClub(req.db, req.tenantId, id, clubSchema.innerType().partial().parse(req.body));
  res.status(200).json(await service.clubWithSessions(req.db, req.tenantId, id));
});

/** DELETE /clubs/:id — solo sin inscripciones (con historial: desactivar). */
const remove = asyncHandler(async (req, res) => {
  res.status(200).json(await service.deleteClub(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** GET /clubs/:id/members?school_period_id=&include_withdrawn= */
const members = asyncHandler(async (req, res) => {
  const schoolPeriodId = uuid.parse(req.query.school_period_id || req.query.schoolPeriodId);
  res.status(200).json(
    await service.listMembers(req.db, req.tenantId, uuid.parse(req.params.id), { schoolPeriodId, includeWithdrawn: req.query.include_withdrawn === 'true' })
  );
});

/**
 * POST /clubs/enroll — { clubId | customName, studentIds: [], schoolPeriodId, notes? }
 * `customName`: opción "OTRO" (se crea la actividad si no existe).
 */
const enroll = asyncHandler(async (req, res) => {
  const data = z
    .object({
      clubId: uuid.optional(),
      customName: z.string().trim().max(100).optional(),
      studentIds: z.array(uuid).min(1, 'Elige al menos un alumno.').max(500),
      schoolPeriodId: uuid,
      notes: optionalText(200),
    })
    .refine((d) => d.clubId || d.customName, { message: 'Elige un club o escribe el nombre de la actividad ("OTRO").', path: ['clubId'] })
    .parse(req.body);
  // Crear una actividad nueva ("OTRO") es de administración; el coordinador inscribe en su club.
  if (!data.clubId) {
    const perms = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
    if (!perms.clubs?.can_create) throw ApiError.forbidden('Solo la administración puede crear actividades nuevas.');
  } else {
    await assertCanManage(req, data.clubId);
  }
  res.status(200).json(await service.enroll(req.db, req.tenantId, data));
});

/** PUT /clubs/memberships/:id/withdraw — retira al alumno (conserva el historial). */
const withdraw = asyncHandler(async (req, res) => {
  const m = await service.loadMembership(req.db, req.tenantId, uuid.parse(req.params.id));
  await assertCanManage(req, m.club_id);
  res.status(200).json(await service.withdraw(req.db, req.tenantId, m.id));
});

/** GET /clubs/students/:studentId — clubes de un alumno (ficha del alumno). */
const forStudent = asyncHandler(async (req, res) => {
  res.status(200).json(await service.studentClubs(req.db, req.tenantId, uuid.parse(req.params.studentId)));
});

module.exports = { list, create, update, remove, members, enroll, withdraw, forStudent };
