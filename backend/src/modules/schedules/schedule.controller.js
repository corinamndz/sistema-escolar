const { z } = require('zod');
const service = require('./schedule.service');
const academicService = require('../academics/academic.service');
const assignmentService = require('../academics/assignment.service');
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

/**
 * POST /schedules/sections/:id/entries — { subjectId, dayOfWeek, timeSlotId, onOccupied? }
 * Arrastrar una materia del panel a una celda. `onOccupied: 'replace'` sobrescribe
 * la clase que hubiera en esa celda.
 */
const placeEntry = asyncHandler(async (req, res) => {
  const { onOccupied, ...data } = cellSchema.extend({ subjectId: uuid, onOccupied: z.enum(['replace']).optional() }).parse(req.body);
  res.status(201).json(await service.placeEntry(req.db, req.tenantId, uuid.parse(req.params.id), data, { onOccupied }));
});

/**
 * PUT /schedules/entries/:id — { dayOfWeek, timeSlotId, onOccupied? }
 * Mover una clase. Si la celda destino está ocupada: 'swap' intercambia las
 * dos clases; 'replace' quita la que estaba.
 */
const moveEntry = asyncHandler(async (req, res) => {
  const data = cellSchema.extend({ onOccupied: z.enum(['replace', 'swap']).optional() }).parse(req.body);
  res.status(200).json(await service.moveEntry(req.db, req.tenantId, uuid.parse(req.params.id), data));
});

/** DELETE /schedules/entries/:id */
const removeEntry = asyncHandler(async (req, res) => {
  res.status(200).json(await service.removeEntry(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/**
 * GET /schedules?school_period_id=&grade_id=&section_id=&teacher_id=
 * Horario filtrado (administración, solo lectura). Todos los filtros son
 * opcionales y combinables; se requiere el año escolar o la sección. Acepta
 * también camelCase (schoolPeriodId, gradeId, sectionId, teacherId).
 */
function parseFilters(q) {
  const pick = (snake, camel) => (q[snake] ?? q[camel]) || undefined;
  return z
    .object({
      schoolPeriodId: uuid.optional(),
      gradeId: uuid.optional(),
      sectionId: uuid.optional(),
      teacherId: uuid.optional(),
    })
    .parse({
      schoolPeriodId: pick('school_period_id', 'schoolPeriodId'),
      gradeId: pick('grade_id', 'gradeId'),
      sectionId: pick('section_id', 'sectionId'),
      teacherId: pick('teacher_id', 'teacherId'),
    });
}

const querySchedule = asyncHandler(async (req, res) => {
  res.status(200).json(await service.querySchedule(req.db, req.tenantId, parseFilters(req.query)));
});

/**
 * GET /schedules/pdf?section_id= | ?teacher_id=&school_period_id= (mismos filtros que GET /schedules)
 * Descarga el horario que se está viendo en PDF (A4 horizontal).
 */
const downloadPdf = asyncHandler(async (req, res) => {
  const { buffer, fileName } = await service.schedulePdf(req.db, req.tenantId, parseFilters(req.query));
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store',
  });
  res.status(200).send(buffer);
});

/** GET /schedules/teachers?school_period_id= — docentes A-Z con sus horas en el año (filtro "Ver por docente"). */
const listTeachers = asyncHandler(async (req, res) => {
  const periodId = uuid.parse(req.query.school_period_id ?? req.query.schoolPeriodId);
  res.status(200).json(await service.listTeachers(req.db, req.tenantId, periodId));
});

/**
 * GET /schedules/grades?school_period_id= — TODOS los grados (jerarquía escolar)
 * con sus secciones en ese año: [{ id, name, level_code, level_name, sections: [{ id, name }] }].
 */
const listGrades = asyncHandler(async (req, res) => {
  const periodId = uuid.parse(req.query.school_period_id ?? req.query.schoolPeriodId);
  res.status(200).json(await service.listGradesForSchedule(req.db, req.tenantId, periodId));
});

/**
 * GET /schedules/assignments?school_period_id=&grade_id=&section_id=&teacher_id=
 * Tabla plana Grado/Sección → Materia → Profesor (incluye las materias SIN
 * profesor) + resumen. Ver assignmentService.listAssignmentMatrix.
 */
const listAssignments = asyncHandler(async (req, res) => {
  const f = parseFilters(req.query);
  if (!f.schoolPeriodId) throw ApiError.badRequest('Indica el año escolar (school_period_id).', [{ path: 'school_period_id', message: 'Requerido.' }]);
  res.status(200).json(await assignmentService.listAssignmentMatrix(req.db, req.tenantId, f));
});

/** GET /schedules/mine — horario semanal del docente autenticado (solo lectura). */
const mySchedule = asyncHandler(async (req, res) => {
  const staff = await req.db('staff').where({ tenant_id: req.tenantId, user_id: req.user.id }).select('id').first();
  if (!staff) throw ApiError.notFound('Tu usuario no está vinculado a una ficha de personal docente.');
  res.status(200).json(await service.getTeacherSchedule(req.db, req.tenantId, staff.id));
});

module.exports = { listSlots, saveSlots, listSections, getSectionSchedule, placeEntry, moveEntry, removeEntry, mySchedule, querySchedule, listTeachers, listGrades, listAssignments, downloadPdf };
