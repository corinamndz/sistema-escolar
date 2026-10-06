const { ApiError } = require('../../utils/ApiError');
const assignmentService = require('../academics/assignment.service');

/**
 * Horarios de clase.
 *
 *   Bloques (time_slots): por año escolar, compartidos por todas sus secciones.
 *   Clase (class_schedules): sección + materia + docente + día + bloque.
 *
 * El docente de cada clase sale de la carga docente de la sección (el
 * profesor de la materia, o en Primaria el titular si la materia no tiene
 * especialista). Al colocar o mover una clase se valida, con mensajes claros,
 * que la celda esté libre y que el docente NO tenga otra clase en el mismo día
 * y bloque en otra sección; la base de datos además lo garantiza con índices
 * únicos (por si dos personas guardan a la vez).
 */

const DAYS = [
  { day: 1, name: 'Lunes' },
  { day: 2, name: 'Martes' },
  { day: 3, name: 'Miércoles' },
  { day: 4, name: 'Jueves' },
  { day: 5, name: 'Viernes' },
];
const dayName = (d) => DAYS.find((x) => x.day === Number(d))?.name || '';
const hhmm = (t) => String(t).slice(0, 5);
const toMinutes = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return h * 60 + m;
};

// ---------------------------------------------------------------------------
// Bloques horarios
// ---------------------------------------------------------------------------

async function loadPeriod(trx, tenantId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  return period;
}

function listSlots(trx, tenantId, periodId) {
  return trx('time_slots')
    .where({ tenant_id: tenantId, school_period_id: periodId })
    .orderBy('start_time')
    .then((rows) => rows.map((s) => ({ ...s, start_time: hhmm(s.start_time), end_time: hhmm(s.end_time) })));
}

/**
 * Reemplaza los bloques del año: actualiza los que traen id, crea los nuevos y
 * borra los que ya no vienen. Valida que no se solapen. Un bloque con clases
 * no se puede borrar ni convertir en recreo.
 */
async function saveSlots(trx, tenantId, periodId, slots) {
  const period = await loadPeriod(trx, tenantId, periodId);
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado.`);

  const sorted = [...slots].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  sorted.forEach((s, i) => {
    if (toMinutes(s.endTime) <= toMinutes(s.startTime)) {
      throw ApiError.badRequest(`${s.name}: la hora de fin debe ser posterior a la de inicio.`, [{ path: `slots.${i}`, message: 'Horas inválidas.' }]);
    }
    const prev = sorted[i - 1];
    if (prev && toMinutes(s.startTime) < toMinutes(prev.endTime)) {
      throw ApiError.badRequest(`${prev.name} (${prev.startTime}–${prev.endTime}) y ${s.name} (${s.startTime}–${s.endTime}) se solapan.`, [
        { path: `slots.${i}`, message: 'Se solapa con otro bloque.' },
      ]);
    }
  });

  const existing = await trx('time_slots').where({ tenant_id: tenantId, school_period_id: periodId });
  const used = new Set(await trx('class_schedules').whereIn('time_slot_id', existing.map((s) => s.id)).distinct().pluck('time_slot_id'));
  const keep = new Set(sorted.filter((s) => s.id).map((s) => s.id));
  for (const s of existing.filter((x) => !keep.has(x.id))) {
    if (used.has(s.id)) throw ApiError.conflict(`${s.name} tiene clases asignadas: quítalas del horario antes de eliminar el bloque.`);
  }
  for (const s of sorted.filter((x) => x.id && x.isBreak)) {
    if (used.has(s.id)) throw ApiError.conflict(`${s.name} tiene clases asignadas: no puede pasar a ser recreo.`);
  }

  // El UNIQUE (año, hora de inicio) es diferible: se puede reordenar sin choques intermedios.
  await trx('time_slots').where({ tenant_id: tenantId, school_period_id: periodId }).whereNotIn('id', [...keep]).delete();
  for (const [i, s] of sorted.entries()) {
    const row = { name: s.name.trim(), start_time: s.startTime, end_time: s.endTime, is_break: Boolean(s.isBreak), sort_order: i };
    if (s.id) {
      const n = await trx('time_slots').where({ id: s.id, tenant_id: tenantId, school_period_id: periodId }).update(row);
      if (!n) throw ApiError.badRequest('Hay bloques que no pertenecen a este año escolar.');
    } else {
      await trx('time_slots').insert({ ...row, tenant_id: tenantId, school_period_id: periodId });
    }
  }
  // Se verifica ya (no al confirmar la transacción, cuando la respuesta ya salió).
  await trx.raw('SET CONSTRAINTS uq_time_slots_start IMMEDIATE');
  return listSlots(trx, tenantId, periodId);
}

// ---------------------------------------------------------------------------
// Horario de una sección
// ---------------------------------------------------------------------------

async function loadSection(trx, tenantId, sectionId) {
  const section = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'sec.id': sectionId, 'sec.tenant_id': tenantId })
    .select('sec.id', 'sec.name', 'sec.grade_id', 'sec.school_period_id', 'g.name as grade_name', 'g.level_code', 'sp.name as school_period_name', 'sp.closed_at as period_closed_at')
    .first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');
  return section;
}

/** Clases con materia, docente y sección (para mostrar y para avisar cruces). */
function entriesQuery(trx, tenantId) {
  return trx('class_schedules as cs')
    .join('subjects as sub', 'sub.id', 'cs.subject_id')
    .join('staff as st', 'st.id', 'cs.staff_id')
    .join('sections as sec', 'sec.id', 'cs.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('time_slots as ts', 'ts.id', 'cs.time_slot_id')
    .where('cs.tenant_id', tenantId)
    .select(
      'cs.id',
      'cs.section_id',
      'cs.subject_id',
      'cs.staff_id',
      'cs.day_of_week',
      'cs.time_slot_id',
      'sub.name as subject_name',
      trx.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
      'sec.name as section_name',
      'g.name as grade_name',
      'ts.start_time',
      'ts.end_time'
    );
}

const formatEntry = (e) => ({ ...e, start_time: hhmm(e.start_time), end_time: hhmm(e.end_time) });

/** Materias del plan de estudios de la sección con su docente según la carga docente. */
async function sectionSubjects(trx, tenantId, sectionId) {
  const a = await assignmentService.getSectionAssignments(trx, tenantId, sectionId);
  return (a.subjects || []).map((s) => ({
    subject_id: s.id,
    subject_name: s.name,
    weekly_hours: s.weekly_hours ?? null,
    teacher: s.effectiveTeacher ? { id: s.effectiveTeacher.id, name: s.effectiveTeacher.name } : null,
  }));
}

/**
 * Horario de la sección. `editable`: además el banco de materias (con horas
 * semanales colocadas) y, por docente, las horas en que ya da clase en OTRAS
 * secciones del año (para marcar en rojo las celdas con cruce al arrastrar).
 */
async function getSectionSchedule(trx, tenantId, sectionId, { editable = false } = {}) {
  const section = await loadSection(trx, tenantId, sectionId);
  const slots = await listSlots(trx, tenantId, section.school_period_id);
  const entries = (await entriesQuery(trx, tenantId).andWhere('cs.section_id', sectionId)).map(formatEntry);
  const result = { section, days: DAYS, slots, entries, read_only: !editable || Boolean(section.period_closed_at) };
  if (!editable) return result;

  const subjects = await sectionSubjects(trx, tenantId, sectionId);
  const teacherOf = new Map(subjects.map((s) => [s.subject_id, s.teacher?.id || null]));
  // Clase cuyo docente ya no coincide con la carga docente actual (se cambió la asignación).
  result.entries = entries.map((e) => ({ ...e, teacher_changed: teacherOf.has(e.subject_id) && teacherOf.get(e.subject_id) !== e.staff_id }));
  result.bank = subjects.map((s) => ({ ...s, placed: entries.filter((e) => e.subject_id === s.subject_id).length }));

  const teacherIds = [...new Set(subjects.map((s) => s.teacher?.id).filter(Boolean))];
  const busy = teacherIds.length
    ? await entriesQuery(trx, tenantId).whereIn('cs.staff_id', teacherIds).whereNot('cs.section_id', sectionId).andWhere('sec.school_period_id', section.school_period_id)
    : [];
  result.teacher_busy = {};
  busy.map(formatEntry).forEach((e) => {
    (result.teacher_busy[e.staff_id] ||= []).push({
      day_of_week: e.day_of_week,
      time_slot_id: e.time_slot_id,
      where: `${e.grade_name} ${e.section_name}`,
      subject_name: e.subject_name,
    });
  });
  return result;
}

/** Mensaje del cruce: "El profesor X ya dicta clase en 2do Año A a esta misma hora (Matemática, lunes 07:00–07:45)". */
const conflictMessage = (c) =>
  `Conflicto de horario: El profesor ${c.teacher_name} ya dicta clase en ${c.grade_name} ${c.section_name} a esta misma hora (${c.subject_name}, ${dayName(c.day_of_week).toLowerCase()} ${hhmm(c.start_time)}–${hhmm(c.end_time)}).`;

/**
 * Coloca una materia en una celda (o mueve una clase existente si viene
 * `entryId`). Valida: año abierto, bloque del año y no recreo, materia del
 * plan de estudios con docente asignado, celda libre y SIN cruce del docente.
 */
async function placeEntry(trx, tenantId, sectionId, { subjectId, dayOfWeek, timeSlotId }, { entryId = null } = {}) {
  const section = await loadSection(trx, tenantId, sectionId);
  if (section.period_closed_at) throw ApiError.unprocessable(`El año escolar ${section.school_period_name} está finalizado: su horario es de solo lectura.`);
  if (!DAYS.some((d) => d.day === Number(dayOfWeek))) throw ApiError.badRequest('Día inválido (lunes a viernes).', [{ path: 'dayOfWeek', message: 'Día inválido.' }]);

  const slot = await trx('time_slots').where({ id: timeSlotId, tenant_id: tenantId }).first();
  if (!slot || slot.school_period_id !== section.school_period_id) {
    throw ApiError.badRequest('El bloque horario no pertenece al año escolar de la sección.', [{ path: 'timeSlotId', message: 'Bloque inválido.' }]);
  }
  if (slot.is_break) throw ApiError.unprocessable(`${slot.name} es un recreo: no admite clases.`, [{ path: 'timeSlotId', message: 'Recreo.' }]);

  const subject = (await sectionSubjects(trx, tenantId, sectionId)).find((s) => s.subject_id === subjectId);
  if (!subject) {
    throw ApiError.unprocessable(`La materia no está en el plan de estudios de ${section.grade_name}.`, [{ path: 'subjectId', message: 'Materia inválida.' }]);
  }
  if (!subject.teacher) {
    throw ApiError.unprocessable(
      `${subject.subject_name} no tiene profesor asignado en ${section.grade_name} ${section.name}: asígnalo en la carga docente antes de ponerla en el horario.`,
      [{ path: 'subjectId', message: 'Sin profesor.' }]
    );
  }

  const where = { 'cs.day_of_week': dayOfWeek, 'cs.time_slot_id': timeSlotId };
  const occupied = await entriesQuery(trx, tenantId).where({ ...where, 'cs.section_id': sectionId }).modify((q) => entryId && q.whereNot('cs.id', entryId)).first();
  if (occupied) {
    throw ApiError.conflict(`Esa hora ya tiene ${occupied.subject_name} (${dayName(dayOfWeek)} ${hhmm(slot.start_time)}–${hhmm(slot.end_time)}). Muévela o quítala primero.`, [
      { path: 'cell', message: 'Celda ocupada.' },
    ]);
  }
  const clash = await entriesQuery(trx, tenantId).where({ ...where, 'cs.staff_id': subject.teacher.id }).modify((q) => entryId && q.whereNot('cs.id', entryId)).first();
  if (clash) {
    throw ApiError.conflict(conflictMessage(clash), [{ path: 'teacher', message: 'Cruce de horario del docente.' }]);
  }

  const row = { subject_id: subjectId, staff_id: subject.teacher.id, day_of_week: dayOfWeek, time_slot_id: timeSlotId };
  let id = entryId;
  try {
    if (entryId) await trx('class_schedules').where({ id: entryId, tenant_id: tenantId }).update(row);
    else [{ id }] = await trx('class_schedules').insert({ ...row, tenant_id: tenantId, section_id: sectionId, grade_id: section.grade_id }).returning('id');
  } catch (err) {
    // Otra persona guardó al mismo tiempo: los índices únicos lo frenan.
    if (err.code === '23505') throw ApiError.conflict('Esa hora acaba de ocuparse (o el docente acaba de recibir otra clase a esa hora). Recarga el horario.');
    throw err;
  }
  return formatEntry(await entriesQuery(trx, tenantId).where('cs.id', id).first());
}

async function loadEntry(trx, tenantId, entryId) {
  const entry = await trx('class_schedules').where({ id: entryId, tenant_id: tenantId }).first();
  if (!entry) throw ApiError.notFound('Clase no encontrada en el horario.');
  return entry;
}

/** Mueve una clase a otro día/bloque de la misma sección (mismas validaciones). */
async function moveEntry(trx, tenantId, entryId, { dayOfWeek, timeSlotId }) {
  const entry = await loadEntry(trx, tenantId, entryId);
  return placeEntry(trx, tenantId, entry.section_id, { subjectId: entry.subject_id, dayOfWeek, timeSlotId }, { entryId });
}

async function removeEntry(trx, tenantId, entryId) {
  const entry = await loadEntry(trx, tenantId, entryId);
  const section = await loadSection(trx, tenantId, entry.section_id);
  if (section.period_closed_at) throw ApiError.unprocessable(`El año escolar ${section.school_period_name} está finalizado: su horario es de solo lectura.`);
  await trx('class_schedules').where({ id: entryId }).delete();
  return { ok: true };
}

/** Sección de un año escolar (para validar el acceso del docente). */
async function sectionOfEntry(trx, tenantId, entryId) {
  return (await loadEntry(trx, tenantId, entryId)).section_id;
}

// ---------------------------------------------------------------------------
// Consulta filtrada (administración): por grado/sección o por docente
// ---------------------------------------------------------------------------

/**
 * Docentes para el filtro "Ver por docente", de la A a la Z: el personal
 * docente activo y, además, cualquiera que ya tenga clases en el año (aunque
 * hoy esté inactivo, para poder auditarlo). `classes` = horas por semana.
 */
async function listTeachers(trx, tenantId, periodId) {
  await loadPeriod(trx, tenantId, periodId);
  const load = trx('class_schedules as cs')
    .join('sections as sec', 'sec.id', 'cs.section_id')
    .where({ 'cs.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .groupBy('cs.staff_id')
    .select('cs.staff_id', trx.raw('COUNT(*)::int AS classes'), trx.raw('COUNT(DISTINCT cs.section_id)::int AS sections'))
    .as('c');
  const rows = await trx('staff as st')
    .leftJoin(load, 'c.staff_id', 'st.id')
    .where('st.tenant_id', tenantId)
    .andWhere((q) => q.where({ 'st.staff_type': 'teaching', 'st.status': 'active' }).orWhereNotNull('c.staff_id'))
    .select('st.id', 'st.first_name', 'st.last_name', 'st.status', 'c.classes', 'c.sections')
    .orderBy([{ column: 'st.first_name' }, { column: 'st.last_name' }]);
  return rows.map((r) => ({
    id: r.id,
    name: `${r.first_name} ${r.last_name}`,
    active: r.status === 'active',
    classes: Number(r.classes || 0),
    sections: Number(r.sections || 0),
  }));
}

/**
 * Resumen para auditar una grilla (sobre todo la de un docente):
 *   - clases por día y total;
 *   - huecos: horas de clase LIBRES entre la primera y la última clase de un
 *     mismo día (tiempo muerto del docente);
 *   - cruces: celdas con más de una clase (la base de datos no lo permite
 *     para un docente, pero se informa por si acaso);
 *   - secciones que atiende, con sus horas.
 */
function summarize(days, slots, entries) {
  const classSlots = slots.filter((s) => !s.is_break);
  const gaps = [];
  const byDay = days.map((d) => {
    const taken = classSlots.map((s) => entries.some((e) => e.day_of_week === d.day && e.time_slot_id === s.id));
    const first = taken.indexOf(true);
    const last = taken.lastIndexOf(true);
    for (let i = first + 1; first >= 0 && i < last; i += 1) {
      if (!taken[i]) gaps.push({ day_of_week: d.day, time_slot_id: classSlots[i].id });
    }
    return { day_of_week: d.day, name: d.name, classes: taken.filter(Boolean).length };
  });

  const cells = new Map();
  entries.forEach((e) => {
    const k = `${e.day_of_week}|${e.time_slot_id}`;
    cells.set(k, (cells.get(k) || 0) + 1);
  });
  const conflicts = [...cells.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => {
      const [day, slot] = k.split('|');
      return { day_of_week: Number(day), time_slot_id: slot };
    });

  const sections = new Map();
  entries.forEach((e) => {
    if (!sections.has(e.section_id)) sections.set(e.section_id, { section_id: e.section_id, label: `${e.grade_name} ${e.section_name}`, classes: 0 });
    sections.get(e.section_id).classes += 1;
  });

  return {
    classes: entries.length,
    capacity: classSlots.length * days.length,
    free_days: byDay.filter((d) => !d.classes).map((d) => d.name),
    by_day: byDay,
    gaps,
    conflicts,
    sections: [...sections.values()].sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true })),
  };
}

/**
 * Horario filtrado de un año escolar. Filtros opcionales y combinables:
 *   - sectionId: una sección (define el año si no se indica);
 *   - gradeId: todas las secciones de un grado;
 *   - teacherId: todas las clases de un docente, en cualquier sección.
 * Devuelve la grilla (días, bloques, clases), el grado/sección/docente
 * filtrados y un resumen para auditar la carga (huecos, días libres, cruces).
 */
async function querySchedule(trx, tenantId, { schoolPeriodId = null, gradeId = null, sectionId = null, teacherId = null }) {
  let periodId = schoolPeriodId;
  let section = null;
  if (sectionId) {
    section = await loadSection(trx, tenantId, sectionId);
    if (periodId && periodId !== section.school_period_id) {
      throw ApiError.badRequest('La sección no pertenece a ese año escolar.', [{ path: 'section_id', message: 'Sección de otro año.' }]);
    }
    if (gradeId && gradeId !== section.grade_id) {
      throw ApiError.badRequest('La sección no pertenece a ese grado.', [{ path: 'section_id', message: 'Sección de otro grado.' }]);
    }
    periodId = section.school_period_id;
  }
  if (!periodId) {
    throw ApiError.badRequest('Indica el año escolar (school_period_id) o la sección (section_id).', [{ path: 'school_period_id', message: 'Requerido.' }]);
  }
  const period = await loadPeriod(trx, tenantId, periodId);

  let grade = null;
  if (gradeId) {
    grade = await trx('grades').where({ id: gradeId, tenant_id: tenantId }).select('id', 'name', 'level_code').first();
    if (!grade) throw ApiError.notFound('Grado no encontrado.');
  }
  let teacher = null;
  if (teacherId) {
    const st = await trx('staff').where({ id: teacherId, tenant_id: tenantId }).select('id', 'first_name', 'last_name', 'staff_type', 'status').first();
    if (!st) throw ApiError.notFound('Docente no encontrado.');
    teacher = { id: st.id, name: `${st.first_name} ${st.last_name}`, staff_type: st.staff_type, active: st.status === 'active' };
  }

  const entries = (
    await entriesQuery(trx, tenantId)
      .andWhere('sec.school_period_id', period.id)
      .modify((q) => {
        if (sectionId) q.andWhere('cs.section_id', sectionId);
        if (gradeId) q.andWhere('sec.grade_id', gradeId);
        if (teacherId) q.andWhere('cs.staff_id', teacherId);
      })
      .orderBy([{ column: 'cs.day_of_week' }, { column: 'ts.start_time' }, { column: 'g.name' }, { column: 'sec.name' }])
  ).map(formatEntry);
  const slots = await listSlots(trx, tenantId, period.id);

  return {
    school_period: { id: period.id, name: period.name, closed: Boolean(period.closed_at) },
    filters: { school_period_id: period.id, grade_id: gradeId, section_id: sectionId, teacher_id: teacherId },
    grade,
    section,
    teacher,
    days: DAYS,
    slots,
    entries,
    summary: summarize(DAYS, slots, entries),
  };
}

// ---------------------------------------------------------------------------
// Consultas de solo lectura: docente y representante
// ---------------------------------------------------------------------------

/**
 * "Mi horario" del docente: sus clases de la semana en los años escolares
 * activos (todas sus secciones), con los bloques de ese año.
 */
async function getTeacherSchedule(trx, tenantId, staffId) {
  const periods = await trx('school_periods').where({ tenant_id: tenantId, is_active: true }).whereNull('closed_at').orderBy('start_date', 'desc');
  const out = [];
  for (const p of periods) {
    const entries = (await entriesQuery(trx, tenantId).where('cs.staff_id', staffId).andWhere('sec.school_period_id', p.id)).map(formatEntry);
    if (!entries.length) continue;
    out.push({ school_period: { id: p.id, name: p.name }, days: DAYS, slots: await listSlots(trx, tenantId, p.id), entries });
  }
  return { staff_id: staffId, periods: out };
}

/** Horario de la sección en que el alumno cursa (inscripción activa del año en curso). */
async function getStudentSchedule(trx, tenantId, studentId) {
  const enrollment = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .orderByRaw('sp.is_active DESC, sp.start_date DESC NULLS LAST')
    .select('e.section_id')
    .first();
  if (!enrollment) return { section: null, days: DAYS, slots: [], entries: [], read_only: true };
  return getSectionSchedule(trx, tenantId, enrollment.section_id);
}

module.exports = {
  DAYS,
  listSlots,
  saveSlots,
  loadPeriod,
  getSectionSchedule,
  placeEntry,
  moveEntry,
  removeEntry,
  sectionOfEntry,
  getTeacherSchedule,
  getStudentSchedule,
  listTeachers,
  querySchedule,
  summarize,
};
