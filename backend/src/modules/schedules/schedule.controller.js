const { z } = require('zod');
const service = require('./schedule.service');
const generator = require('./scheduleGenerator.service');
const evaluationCalendar = require('./evaluationCalendar.service');
const academicService = require('../academics/academic.service');
const assignmentService = require('../academics/assignment.service');
const teacherScope = require('../access/teacherScope');
const coordinator = require('../access/coordinatorScope');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');

const uuid = z.string().uuid();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM).');

// ---------------------------------------------------------------------------
// Coordinador: Horarios SOLO de su nivel (grados con level_code = su nivel).
// requireLevel → { level } si es coordinador restringido (403 si no tiene nivel), null si no.
// ---------------------------------------------------------------------------

const outOfLevel = (what) => ApiError.notFound(`${what} no encontrado o fuera de tu nivel de coordinación.`);

async function assertSectionsInLevel(req, scope, sectionIds) {
  if (!scope || !sectionIds.length) return;
  const rows = await req.db('sections as sec').join('grades as g', 'g.id', 'sec.grade_id').where('sec.tenant_id', req.tenantId).whereIn('sec.id', sectionIds).select('sec.id', 'g.level_code');
  if (rows.length !== new Set(sectionIds).size || rows.some((r) => r.level_code !== scope.level)) throw outOfLevel('Sección');
}
async function assertGradeInLevel(req, scope, gradeId) {
  if (!scope || !gradeId) return;
  const g = await req.db('grades').where({ id: gradeId, tenant_id: req.tenantId }).first('level_code');
  if (!g || g.level_code !== scope.level) throw outOfLevel('Grado');
}
async function assertTeacherInLevel(req, scope, staffId) {
  if (!scope || !staffId) return;
  if (!(await coordinator.coversStaffId(req.db, req.tenantId, scope, staffId))) throw outOfLevel('Docente');
}
async function assertEntryInLevel(req, scope, entryId) {
  if (!scope) return;
  const e = await req.db('class_schedules').where({ id: entryId, tenant_id: req.tenantId }).first('section_id');
  if (e) await assertSectionsInLevel(req, scope, [e.section_id]); // sin clase: el servicio responde 404
}
async function assertGenerationInLevel(req, scope, id) {
  if (!scope) return;
  const gen = await req.db('schedule_generations').where({ id, tenant_id: req.tenantId }).first('section_ids');
  if (gen) await assertSectionsInLevel(req, scope, gen.section_ids);
}
/** Filtros de consulta validados contra el nivel del coordinador (+ levelCode para el servicio). */
async function scopedFilters(req) {
  const f = parseFilters(req.query);
  const scope = await coordinator.requireLevel(req);
  if (!scope) return f;
  if (f.sectionId) await assertSectionsInLevel(req, scope, [f.sectionId]);
  await assertGradeInLevel(req, scope, f.gradeId);
  await assertTeacherInLevel(req, scope, f.teacherId);
  return { ...f, levelCode: scope.level };
}

/** GET /schedules/periods — años escolares para el selector (sin depender del módulo Académico). */
const listPeriods = asyncHandler(async (req, res) => {
  res.status(200).json(await academicService.listSchoolPeriods(req.db, req.tenantId));
});

/** GET /schedules/periods/:periodId/slots */
const listSlots = asyncHandler(async (req, res) => {
  const period = await service.loadPeriod(req.db, req.tenantId, uuid.parse(req.params.periodId));
  res.status(200).json(await service.listSlots(req.db, req.tenantId, period.id));
});

/** PUT /schedules/periods/:periodId/slots — { slots: [{ id?, name, startTime, endTime, isBreak? }] } */
const saveSlots = asyncHandler(async (req, res) => {
  // Los bloques horarios son de TODO el colegio (todas las secciones del año los comparten).
  if (await coordinator.requireLevel(req)) throw ApiError.forbidden('Los bloques horarios son de todo el colegio: solo el Director puede cambiarlos.');
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
  const scope = await coordinator.requireLevel(req);
  res.status(200).json(await academicService.listSections(req.db, req.tenantId, { schoolPeriodId: req.query.schoolPeriodId, levelCode: scope?.level || undefined }));
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
  // Coordinador: secciones de su nivel (de cualquier año), editable según sus permisos.
  await assertSectionsInLevel(req, await coordinator.requireLevel(req), [sectionId]);
  const perms = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
  if (!perms.schedules?.can_read) throw ApiError.forbidden('No tienes permiso de "read" sobre "schedules".');
  return res.status(200).json(await service.getSectionSchedule(req.db, req.tenantId, sectionId, { editable: Boolean(perms.schedules.can_update) }));
});

/** Acceso a la sección: docente solo las suyas; si no, permiso de lectura de Horarios. */
async function assertSectionRead(req, sectionId) {
  const scope = await teacherScope.getTeacherScope(req);
  if (scope) return teacherScope.assertSectionAccess(req, sectionId);
  await assertSectionsInLevel(req, await coordinator.requireLevel(req), [sectionId]);
  const perms = await getEffectivePermissions(req.db, req.tenantId, req.user.id);
  if (!perms.schedules?.can_read) throw ApiError.forbidden('No tienes permiso de "read" sobre "schedules".');
  return null;
}

const evaluationQuery = (q) =>
  z
    .object({ sectionId: uuid, termNumber: z.coerce.number().int().min(1).max(3).optional() })
    .parse({ sectionId: q.section_id ?? q.sectionId, termNumber: q.term_number ?? q.termNumber ?? undefined });

/**
 * GET /schedules/evaluations?section_id=&term_number=
 * Horario de evaluaciones de la sección, sincronizado con los planes de
 * evaluación (fechas) y el horario de clases (horas). Ver evaluationCalendar.service.
 */
const getEvaluationCalendar = asyncHandler(async (req, res) => {
  const f = evaluationQuery(req.query);
  await assertSectionRead(req, f.sectionId);
  res.status(200).json(await evaluationCalendar.getEvaluationCalendar(req.db, req.tenantId, f));
});

/** GET /schedules/evaluations/pdf?section_id=&term_number= — el calendario en PDF. */
const downloadEvaluationPdf = asyncHandler(async (req, res) => {
  const f = evaluationQuery(req.query);
  await assertSectionRead(req, f.sectionId);
  const { buffer, fileName } = await service.evaluationCalendarPdf(req.db, req.tenantId, f);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store',
  });
  res.status(200).send(buffer);
});

const cellSchema = z.object({ dayOfWeek: z.coerce.number().int().min(1).max(5), timeSlotId: uuid });

/**
 * POST /schedules/sections/:id/entries — { subjectId, dayOfWeek, timeSlotId, onOccupied? }
 * Arrastrar una materia del panel a una celda. `onOccupied: 'replace'` sobrescribe
 * la clase que hubiera en esa celda.
 */
const placeEntry = asyncHandler(async (req, res) => {
  const { onOccupied, ...data } = cellSchema.extend({ subjectId: uuid, onOccupied: z.enum(['replace']).optional() }).parse(req.body);
  await assertSectionsInLevel(req, await coordinator.requireLevel(req), [uuid.parse(req.params.id)]);
  res.status(201).json(await service.placeEntry(req.db, req.tenantId, uuid.parse(req.params.id), data, { onOccupied }));
});

/**
 * PUT /schedules/entries/:id — { dayOfWeek, timeSlotId, onOccupied? }
 * Mover una clase. Si la celda destino está ocupada: 'swap' intercambia las
 * dos clases; 'replace' quita la que estaba.
 */
const moveEntry = asyncHandler(async (req, res) => {
  const data = cellSchema.extend({ onOccupied: z.enum(['replace', 'swap']).optional() }).parse(req.body);
  await assertEntryInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.id));
  res.status(200).json(await service.moveEntry(req.db, req.tenantId, uuid.parse(req.params.id), data));
});

/** DELETE /schedules/entries/:id */
const removeEntry = asyncHandler(async (req, res) => {
  await assertEntryInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.id));
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
  res.status(200).json(await service.querySchedule(req.db, req.tenantId, await scopedFilters(req)));
});

/**
 * GET /schedules/pdf?section_id= | ?teacher_id=&school_period_id= (mismos filtros que GET /schedules)
 * Descarga el horario que se está viendo en PDF (A4 horizontal).
 */
const downloadPdf = asyncHandler(async (req, res) => {
  const { buffer, fileName } = await service.schedulePdf(req.db, req.tenantId, await scopedFilters(req));
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
  const scope = await coordinator.requireLevel(req);
  res.status(200).json(await service.listTeachers(req.db, req.tenantId, periodId, { levelCode: scope?.level || null }));
});

/**
 * GET /schedules/grades?school_period_id= — TODOS los grados (jerarquía escolar)
 * con sus secciones en ese año: [{ id, name, level_code, level_name, sections: [{ id, name }] }].
 */
const listGrades = asyncHandler(async (req, res) => {
  const periodId = uuid.parse(req.query.school_period_id ?? req.query.schoolPeriodId);
  const scope = await coordinator.requireLevel(req);
  res.status(200).json(await service.listGradesForSchedule(req.db, req.tenantId, periodId, { levelCode: scope?.level || null }));
});

/**
 * GET /schedules/assignments?school_period_id=&grade_id=&section_id=&teacher_id=
 * Tabla plana Grado/Sección → Materia → Profesor (incluye las materias SIN
 * profesor) + resumen. Ver assignmentService.listAssignmentMatrix.
 */
const listAssignments = asyncHandler(async (req, res) => {
  const f = await scopedFilters(req);
  if (!f.schoolPeriodId) throw ApiError.badRequest('Indica el año escolar (school_period_id).', [{ path: 'school_period_id', message: 'Requerido.' }]);
  res.status(200).json(await assignmentService.listAssignmentMatrix(req.db, req.tenantId, f));
});

/** GET /schedules/mine — horario semanal del docente autenticado (solo lectura). */
const mySchedule = asyncHandler(async (req, res) => {
  const staff = await req.db('staff').where({ tenant_id: req.tenantId, user_id: req.user.id }).select('id').first();
  if (!staff) throw ApiError.notFound('Tu usuario no está vinculado a una ficha de personal docente.');
  res.status(200).json(await service.getTeacherSchedule(req.db, req.tenantId, staff.id));
});

// ---------------------------------------------------------------------------
// Generador automático (vista previa → aplicar) y disponibilidad docente
// ---------------------------------------------------------------------------

/**
 * POST /schedules/periods/:periodId/generate — { sectionIds?, mode? }
 *   mode 'fill' (por defecto): completa las horas que faltan respetando lo ya puesto;
 *   mode 'replace': rehace desde cero el horario de esas secciones.
 * No modifica el horario: devuelve la vista previa (ver scheduleGenerator.service).
 */
const generate = asyncHandler(async (req, res) => {
  const body = z
    .object({ sectionIds: z.array(uuid).max(300).optional(), mode: z.enum(['fill', 'replace']).default('fill') })
    .parse(req.body || {});
  const periodId = uuid.parse(req.params.periodId);
  const scope = await coordinator.requireLevel(req);
  if (scope) {
    // Coordinador: solo secciones de su nivel; "todo el año" = todas las de su nivel.
    if (body.sectionIds?.length) await assertSectionsInLevel(req, scope, body.sectionIds);
    else {
      body.sectionIds = await coordinator.levelSectionIds(req.db, req.tenantId, scope.level, { activeOnly: false, schoolPeriodId: periodId });
      if (!body.sectionIds.length) throw ApiError.unprocessable(`No hay secciones de ${coordinator.LEVEL_LABELS[scope.level]} en este año escolar.`);
    }
  }
  res.status(201).json(await generator.generate(req.db, req.tenantId, periodId, body, req.user.id));
});

/** GET /schedules/generations/:id — vista previa guardada (`stale`: los datos cambiaron). */
const getGeneration = asyncHandler(async (req, res) => {
  await assertGenerationInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.id));
  res.status(200).json(await generator.getGeneration(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** POST /schedules/generations/:id/apply — guarda en el horario lo revisado. */
const applyGeneration = asyncHandler(async (req, res) => {
  await assertGenerationInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.id));
  res.status(200).json(await generator.apply(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** DELETE /schedules/generations/:id — descarta la vista previa. */
const discardGeneration = asyncHandler(async (req, res) => {
  await assertGenerationInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.id));
  res.status(200).json(await generator.discard(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** GET /schedules/periods/:periodId/unavailability/:staffId */
const getUnavailability = asyncHandler(async (req, res) => {
  await assertTeacherInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.staffId));
  res.status(200).json(await generator.getUnavailability(req.db, req.tenantId, uuid.parse(req.params.periodId), uuid.parse(req.params.staffId)));
});

/** PUT /schedules/periods/:periodId/unavailability/:staffId — { cells: [{ dayOfWeek, timeSlotId, reason? }] } */
const saveUnavailability = asyncHandler(async (req, res) => {
  const { cells } = z
    .object({
      cells: z.array(z.object({ dayOfWeek: z.number().int().min(1).max(5), timeSlotId: uuid, reason: z.string().max(120).optional().nullable() })).max(200),
    })
    .parse(req.body);
  await assertTeacherInLevel(req, await coordinator.requireLevel(req), uuid.parse(req.params.staffId));
  res.status(200).json(await generator.saveUnavailability(req.db, req.tenantId, uuid.parse(req.params.periodId), uuid.parse(req.params.staffId), cells));
});

module.exports = { listPeriods, generate, getGeneration, applyGeneration, discardGeneration, getUnavailability, saveUnavailability, listSlots, saveSlots, listSections, getSectionSchedule, placeEntry, moveEntry, removeEntry, mySchedule, querySchedule, listTeachers, listGrades, listAssignments, downloadPdf, getEvaluationCalendar, downloadEvaluationPdf };
