const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');
const assignmentService = require('../academics/assignment.service');
const scheduleService = require('./schedule.service');
const { solve } = require('./scheduleSolver');

/**
 * Generador automático de horarios de un año escolar (school_period).
 *
 * Flujo: generar (vista previa) → revisar → aplicar o descartar.
 *   1. generate: carga los datos (bloques, secciones, plan de estudios con horas
 *      semanales, docente de cada materia, disponibilidad, aulas y clases ya
 *      existentes), detecta lo imposible ANTES de buscar, corre el motor
 *      (scheduleSolver) y guarda la propuesta en schedule_generations SIN tocar
 *      el horario.
 *   2. apply: vuelve a cargar los datos; si cambiaron desde la vista previa
 *      (input_hash distinto), responde 409 para que se genere de nuevo. Si no,
 *      escribe las clases (en modo "rehacer" borra antes las de esas secciones).
 *      Los índices únicos de class_schedules siguen garantizando el anti-cruce.
 *
 * Modos:
 *   fill    — completar: respeta las clases ya puestas y coloca las horas que faltan;
 *   replace — rehacer: ignora las clases de las secciones elegidas y arma su horario de cero.
 * En ambos, las clases de las DEMÁS secciones del año quedan fijas (sus docentes están ocupados).
 */

const hhmm = (t) => String(t).slice(0, 5);
const dayName = (d) => scheduleService.DAYS.find((x) => x.day === Number(d))?.name || '';
const cellLabel = (day, slot) => `${dayName(day).toLowerCase()} ${hhmm(slot.start_time)}–${hhmm(slot.end_time)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lista legible y corta: "a, b y 3 más". */
function shortList(items, max = 3) {
  if (items.length <= max) return items.join(', ').replace(/, ([^,]*)$/, ' y $1');
  return `${items.slice(0, max).join(', ')} y ${items.length - max} más`;
}

// ---------------------------------------------------------------------------
// Datos de entrada
// ---------------------------------------------------------------------------

async function loadInputs(trx, tenantId, periodId, { sectionIds = null, mode }) {
  const period = await scheduleService.loadPeriod(trx, tenantId, periodId);
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado: su horario es de solo lectura.`);

  const allSlots = await scheduleService.listSlots(trx, tenantId, periodId);
  const slots = allSlots.filter((s) => !s.is_break);
  const days = scheduleService.DAYS.map((d) => d.day);

  const sectionRows = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .leftJoin('classrooms as c', 'c.id', 'sec.classroom_id')
    .where({ 'sec.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .select('sec.id', 'sec.name', 'sec.grade_id', 'sec.classroom_id', 'c.name as classroom_name', 'g.name as grade_name', 'g.level_code', 'el.name as level_name')
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'g.name' }, { column: 'sec.name' }]);
  if (sectionIds?.length) {
    const known = new Set(sectionRows.map((s) => s.id));
    const foreign = sectionIds.filter((id) => !known.has(id));
    if (foreign.length) throw ApiError.badRequest('Hay secciones que no pertenecen a este año escolar.', [{ path: 'sectionIds', message: 'Sección de otro año.' }]);
  }
  const scope = sectionIds?.length ? sectionRows.filter((s) => sectionIds.includes(s.id)) : sectionRows;
  const scopeIds = new Set(scope.map((s) => s.id));

  // Plan de estudios con horas y docente de cada sección del alcance (carga docente vigente).
  const subjectsBySection = new Map();
  for (const sec of scope) {
    const a = await assignmentService.getSectionAssignments(trx, tenantId, sec.id);
    subjectsBySection.set(
      sec.id,
      (a.subjects || []).map((s) => ({
        subject_id: s.id,
        subject_name: s.name,
        weekly_hours: s.weekly_hours ?? null,
        teacher_id: s.effectiveTeacher?.id || null,
        teacher_name: s.effectiveTeacher?.name || null,
      }))
    );
  }

  const entries = await trx('class_schedules as cs')
    .join('sections as sec', 'sec.id', 'cs.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('subjects as sub', 'sub.id', 'cs.subject_id')
    .where({ 'cs.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .select('cs.id', 'cs.section_id', 'cs.subject_id', 'cs.staff_id', 'cs.day_of_week', 'cs.time_slot_id', 'sec.classroom_id', 'sec.name as section_name', 'g.name as grade_name', 'sub.name as subject_name')
    .orderBy('cs.id');

  const unavailable = slots.length
    ? await trx('teacher_unavailability').where({ tenant_id: tenantId }).whereIn('time_slot_id', slots.map((s) => s.id)).select('staff_id', 'day_of_week', 'time_slot_id', 'reason').orderBy(['staff_id', 'day_of_week', 'time_slot_id'])
    : [];

  const staffIds = [...new Set([...[...subjectsBySection.values()].flat().map((s) => s.teacher_id), ...entries.map((e) => e.staff_id)].filter(Boolean))];
  const staff = staffIds.length ? await trx('staff').whereIn('id', staffIds).select('id', 'first_name', 'last_name') : [];
  const teacherName = new Map(staff.map((s) => [s.id, `${s.first_name} ${s.last_name}`]));

  // Huella: si algo de esto cambia entre la vista previa y el guardado, hay que regenerar.
  const inputHash = crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        mode,
        slots: allSlots.map((s) => [s.id, s.start_time, s.end_time, s.is_break]),
        scope: scope.map((s) => [s.id, s.classroom_id, subjectsBySection.get(s.id).map((x) => [x.subject_id, x.weekly_hours, x.teacher_id])]),
        rooms: sectionRows.map((s) => [s.id, s.classroom_id]),
        entries: entries.map((e) => [e.id, e.section_id, e.subject_id, e.staff_id, e.day_of_week, e.time_slot_id]),
        unavailable: unavailable.map((u) => [u.staff_id, u.day_of_week, u.time_slot_id]),
      })
    )
    .digest('hex');

  return { period, allSlots, slots, days, sectionRows, scope, scopeIds, subjectsBySection, entries, unavailable, teacherName, inputHash };
}

// ---------------------------------------------------------------------------
// Generar (vista previa)
// ---------------------------------------------------------------------------

/**
 * Corre el generador y guarda la propuesta. No modifica el horario.
 * → { id, status, mode, school_period, days, slots, sections, teachers, entries, conflicts, stats }
 */
async function generate(trx, tenantId, periodId, { sectionIds = null, mode = 'fill', timeMs = 6000 } = {}, userId = null) {
  const data = await loadInputs(trx, tenantId, periodId, { sectionIds, mode });
  const { slots, days, scope, scopeIds, subjectsBySection, entries, unavailable, teacherName, sectionRows } = data;
  const conflicts = [];
  const slotById = new Map(data.allSlots.map((s) => [s.id, s]));
  const sectionLabel = (s) => `${s.grade_name} ${s.name}`;

  if (!slots.length) {
    throw ApiError.unprocessable(`El año escolar ${data.period.name} no tiene bloques horarios de clase. Configúralos en "Bloques horarios" antes de generar.`);
  }
  if (!scope.length) throw ApiError.unprocessable('No hay secciones en este año escolar para generar su horario.');

  // ---- Clases fijas y horas ya colocadas ----
  const roomOf = new Map(sectionRows.map((s) => [s.id, s.classroom_id]));
  const fixedEntries = entries.filter((e) => !(mode === 'replace' && scopeIds.has(e.section_id)));
  const fixed = fixedEntries.map((e) => ({
    sectionId: e.section_id,
    teacherId: e.staff_id,
    roomId: roomOf.get(e.section_id) || null,
    day: e.day_of_week,
    slotId: e.time_slot_id,
    label: `${e.grade_name} ${e.section_name} (${e.subject_name})`,
  }));
  const placedCount = new Map(); // `${section}|${subject}` → horas ya en el horario
  fixedEntries.filter((e) => scopeIds.has(e.section_id)).forEach((e) => placedCount.set(`${e.section_id}|${e.subject_id}`, (placedCount.get(`${e.section_id}|${e.subject_id}`) || 0) + 1));

  // ---- Grupos a colocar + problemas de datos ----
  const groups = [];
  const meta = new Map();
  for (const sec of scope) {
    const subjects = subjectsBySection.get(sec.id);
    if (!subjects.length) {
      conflicts.push({ type: 'no_curriculum', severity: 'warning', section_id: sec.id, message: `${sectionLabel(sec)} no tiene materias en su plan de estudios: no se le genera horario.` });
      continue;
    }
    for (const s of subjects) {
      const base = { section_id: sec.id, subject_id: s.subject_id, teacher_id: s.teacher_id };
      if (!s.weekly_hours) {
        conflicts.push({ type: 'no_hours', severity: 'error', ...base, message: `${s.subject_name} en ${sectionLabel(sec)} no tiene horas semanales definidas en el plan de estudios del grado.` });
        continue;
      }
      if (!s.teacher_id) {
        conflicts.push({ type: 'no_teacher', severity: 'error', ...base, message: `Falta profesor: ${s.subject_name} en ${sectionLabel(sec)} no tiene docente asignado (${plural(s.weekly_hours, 'hora', 'horas')} sin cubrir).` });
        continue;
      }
      const already = placedCount.get(`${sec.id}|${s.subject_id}`) || 0;
      if (already > s.weekly_hours) {
        conflicts.push({ type: 'over_hours', severity: 'warning', ...base, message: `${s.subject_name} en ${sectionLabel(sec)} ya tiene ${already} horas en el horario y su plan pide ${s.weekly_hours}.` });
      }
      const hours = Math.max(0, s.weekly_hours - already);
      if (!hours) continue;
      const key = `${sec.id}|${s.subject_id}`;
      groups.push({ key, sectionId: sec.id, teacherId: s.teacher_id, roomId: sec.classroom_id || null, hours });
      meta.set(key, { section: sec, subject: s, hours, already });
    }
  }

  // ---- Imposibles por capacidad (antes de buscar) ----
  const C = days.length * slots.length;
  const unavailableBy = new Map();
  unavailable.forEach((u) => unavailableBy.set(u.staff_id, (unavailableBy.get(u.staff_id) || 0) + 1));
  const sectionDemand = new Map();
  groups.forEach((g) => sectionDemand.set(g.sectionId, (sectionDemand.get(g.sectionId) || 0) + g.hours));
  for (const sec of scope) {
    const fixedHere = fixed.filter((f) => f.sectionId === sec.id).length;
    const need = (sectionDemand.get(sec.id) || 0) + fixedHere;
    if (need > C) {
      conflicts.push({
        type: 'section_capacity',
        severity: 'error',
        section_id: sec.id,
        message: `${sectionLabel(sec)} necesita ${need} horas semanales y solo hay ${C} bloques de clase (${days.length} días × ${slots.length} bloques). Reduce horas del plan o agrega bloques.`,
      });
    }
  }
  const teacherDemand = new Map();
  groups.forEach((g) => teacherDemand.set(g.teacherId, (teacherDemand.get(g.teacherId) || 0) + g.hours));
  for (const [teacherId, demand] of teacherDemand) {
    const busy = fixed.filter((f) => f.teacherId === teacherId).length;
    const capacity = C - (unavailableBy.get(teacherId) || 0) - busy;
    if (demand > capacity) {
      conflicts.push({
        type: 'teacher_capacity',
        severity: 'error',
        teacher_id: teacherId,
        message: `El profesor ${teacherName.get(teacherId)} necesita ${demand} horas más y solo le quedan ${Math.max(0, capacity)} bloques libres (${busy} ya ocupados en otras secciones, ${unavailableBy.get(teacherId) || 0} no disponibles).`,
      });
    }
  }
  const impossible = conflicts.some((c) => c.type === 'section_capacity' || c.type === 'teacher_capacity');

  // ---- Búsqueda ----
  const out = solve({
    days,
    slots: slots.map((s) => ({ id: s.id })),
    groups,
    fixed,
    unavailable: unavailable.map((u) => ({ teacherId: u.staff_id, day: u.day_of_week, slotId: u.time_slot_id, reason: u.reason })),
    // Si ya se sabe que no cabe todo, no se gasta el presupuesto entero buscando.
    options: { timeMs: impossible ? Math.min(timeMs, 1500) : timeMs, seed: 1 },
  });

  // ---- Diagnóstico de lo que quedó sin colocar ----
  const groupLabel = (key) => {
    const m = meta.get(key);
    return m ? `${m.section.grade_name} ${m.section.name} (${m.subject.subject_name})` : '';
  };
  for (const u of out.unplaced) {
    const m = meta.get(u.key);
    const { reasons } = u;
    const who = `${m.subject.subject_name} en ${sectionLabel(m.section)}`;
    const parts = [];
    if (reasons.teacherBusy.length) {
      const examples = reasons.teacherBusy.map((r) => `${cellLabel(r.day, slotById.get(r.slotId))} en ${r.with || groupLabel(r.withGroup)}`);
      parts.push(`el profesor ${m.subject.teacher_name} tiene solapamiento en ${plural(reasons.teacherBusy.length, 'bloque', 'bloques')} (${shortList(examples)})`);
    }
    if (reasons.teacherUnavailable.length) {
      parts.push(`no está disponible en ${plural(reasons.teacherUnavailable.length, 'bloque', 'bloques')} (${shortList(reasons.teacherUnavailable.map((r) => cellLabel(r.day, slotById.get(r.slotId)) + (r.reason ? ` — ${r.reason}` : '')))})`);
    }
    if (reasons.roomBusy.length) {
      parts.push(`el aula ${m.section.classroom_name || ''} está ocupada por otra sección en ${plural(reasons.roomBusy.length, 'bloque', 'bloques')} (${shortList(reasons.roomBusy.map((r) => `${cellLabel(r.day, slotById.get(r.slotId))}: ${r.with || groupLabel(r.withGroup)}`))})`);
    }
    if (reasons.sectionFull) parts.push(`la sección ya tiene clase en ${plural(reasons.sectionFull, 'bloque', 'bloques')}`);
    if (reasons.dailyCap) parts.push(`${plural(reasons.dailyCap, 'bloque queda', 'bloques quedan')} en días que ya tienen el máximo de horas de la materia`);
    if (reasons.free) parts.push(`${plural(reasons.free, 'bloque libre se necesitó', 'bloques libres se necesitaron')} para otras materias`);
    conflicts.push({
      type: 'unplaced',
      severity: 'error',
      section_id: m.section.id,
      subject_id: m.subject.subject_id,
      teacher_id: m.subject.teacher_id,
      missing: u.missing,
      message: `${who}: faltan ${plural(u.missing, 'hora', 'horas')} de ${m.hours + m.already}. ${parts.length ? `${capitalize(parts.join('; '))}.` : ''}`.trim(),
    });
  }

  // ---- Propuesta ----
  const proposed = out.placements.map((p) => {
    const m = meta.get(p.key);
    const slot = slotById.get(p.slotId);
    return {
      section_id: m.section.id,
      grade_id: m.section.grade_id,
      subject_id: m.subject.subject_id,
      staff_id: m.subject.teacher_id,
      day_of_week: p.day,
      time_slot_id: p.slotId,
      subject_name: m.subject.subject_name,
      teacher_name: m.subject.teacher_name,
      section_name: m.section.name,
      grade_name: m.section.grade_name,
      start_time: hhmm(slot.start_time),
      end_time: hhmm(slot.end_time),
      is_new: true,
    };
  });
  // Lo que se conserva de las secciones del alcance (modo completar), para que la vista previa muestre el horario entero.
  const kept = fixedEntries
    .filter((e) => scopeIds.has(e.section_id))
    .map((e) => {
      const slot = slotById.get(e.time_slot_id);
      return {
        section_id: e.section_id,
        subject_id: e.subject_id,
        staff_id: e.staff_id,
        day_of_week: e.day_of_week,
        time_slot_id: e.time_slot_id,
        subject_name: e.subject_name,
        teacher_name: teacherName.get(e.staff_id) || '',
        section_name: e.section_name,
        grade_name: e.grade_name,
        start_time: hhmm(slot.start_time),
        end_time: hhmm(slot.end_time),
        is_new: false,
      };
    });

  const required = groups.reduce((s, g) => s + g.hours, 0);
  const missingTotal = conflicts.filter((c) => c.type === 'no_teacher' || c.type === 'no_hours').length;
  const sectionsComplete = scope.filter((sec) => !conflicts.some((c) => c.section_id === sec.id && c.severity === 'error')).length;
  const stats = {
    ...out.stats,
    required,
    placed: proposed.length,
    kept: kept.length,
    sections: scope.length,
    sections_complete: sectionsComplete,
    subjects_without_data: missingTotal,
    complete: out.complete && !conflicts.some((c) => c.severity === 'error'),
  };
  const sortedConflicts = conflicts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

  const [row] = await trx('schedule_generations')
    .insert({
      tenant_id: tenantId,
      school_period_id: periodId,
      status: 'preview',
      mode,
      section_ids: scope.map((s) => s.id),
      input_hash: data.inputHash,
      result: JSON.stringify({ entries: proposed, kept, conflicts: sortedConflicts, stats }),
      created_by: userId,
    })
    .returning(['id', 'status', 'created_at']);

  return formatGeneration(row, { mode, data, entries: proposed, kept, conflicts: sortedConflicts, stats });
}

function formatGeneration(row, { mode, data, entries, kept, conflicts, stats }) {
  const teachers = new Map();
  [...entries, ...kept].forEach((e) => {
    if (!teachers.has(e.staff_id)) teachers.set(e.staff_id, { id: e.staff_id, name: e.teacher_name, classes: 0 });
    teachers.get(e.staff_id).classes += 1;
  });
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    mode,
    school_period: { id: data.period.id, name: data.period.name },
    days: scheduleService.DAYS,
    slots: data.allSlots,
    sections: data.scope.map((s) => ({ id: s.id, name: s.name, grade_name: s.grade_name, level_name: s.level_name, classroom_name: s.classroom_name || null })),
    teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    entries,
    kept,
    conflicts,
    stats,
  };
}

async function loadGeneration(trx, tenantId, id) {
  const gen = await trx('schedule_generations').where({ id, tenant_id: tenantId }).first();
  if (!gen) throw ApiError.notFound('Generación de horario no encontrada.');
  return gen;
}

async function getGeneration(trx, tenantId, id) {
  const gen = await loadGeneration(trx, tenantId, id);
  const data = await loadInputs(trx, tenantId, gen.school_period_id, { sectionIds: gen.section_ids, mode: gen.mode }).catch(() => null);
  const result = gen.result;
  if (!data) return { id: gen.id, status: gen.status, mode: gen.mode, ...result };
  return { ...formatGeneration(gen, { mode: gen.mode, data, ...result }), stale: data.inputHash !== gen.input_hash };
}

// ---------------------------------------------------------------------------
// Aplicar / descartar
// ---------------------------------------------------------------------------

/** Escribe en el horario lo que se revisó en la vista previa. */
async function apply(trx, tenantId, id) {
  const gen = await loadGeneration(trx, tenantId, id);
  if (gen.status !== 'preview') throw ApiError.conflict(gen.status === 'applied' ? 'Este horario ya se guardó.' : 'Esta vista previa se descartó: genera el horario de nuevo.');
  const data = await loadInputs(trx, tenantId, gen.school_period_id, { sectionIds: gen.section_ids, mode: gen.mode });
  if (data.inputHash !== gen.input_hash) {
    throw ApiError.conflict(
      'Los datos cambiaron desde la vista previa (clases, carga docente, bloques o disponibilidad). Genera el horario de nuevo para no pisar esos cambios.'
    );
  }
  const { entries } = gen.result;
  let removed = 0;
  if (gen.mode === 'replace') {
    removed = await trx('class_schedules').where({ tenant_id: tenantId }).whereIn('section_id', gen.section_ids).delete();
  }
  try {
    if (entries.length) {
      await trx('class_schedules').insert(
        entries.map((e) => ({
          tenant_id: tenantId,
          section_id: e.section_id,
          grade_id: e.grade_id,
          subject_id: e.subject_id,
          staff_id: e.staff_id,
          day_of_week: e.day_of_week,
          time_slot_id: e.time_slot_id,
          generation_id: gen.id,
        }))
      );
    }
  } catch (err) {
    if (err.code === '23505') throw ApiError.conflict('Otra persona acaba de modificar el horario y hay un cruce con lo generado. Genera el horario de nuevo.');
    throw err;
  }
  await trx('schedule_generations').where({ id: gen.id }).update({ status: 'applied', applied_at: trx.fn.now() });
  // Las demás vistas previas del año ya no corresponden al horario guardado.
  await trx('schedule_generations').where({ tenant_id: tenantId, school_period_id: gen.school_period_id, status: 'preview' }).whereNot({ id: gen.id }).update({ status: 'discarded' });
  return { id: gen.id, status: 'applied', inserted: entries.length, removed, sections: gen.section_ids.length };
}

async function discard(trx, tenantId, id) {
  const gen = await loadGeneration(trx, tenantId, id);
  if (gen.status === 'applied') throw ApiError.conflict('Este horario ya se guardó: edítalo desde la grilla.');
  await trx('schedule_generations').where({ id: gen.id }).update({ status: 'discarded' });
  return { id: gen.id, status: 'discarded' };
}

// ---------------------------------------------------------------------------
// Disponibilidad de los docentes
// ---------------------------------------------------------------------------

/** Bloques NO disponibles del docente en el año: [{ day_of_week, time_slot_id, reason }]. */
async function getUnavailability(trx, tenantId, periodId, staffId) {
  await scheduleService.loadPeriod(trx, tenantId, periodId);
  const staff = await trx('staff').where({ id: staffId, tenant_id: tenantId }).first('id', 'first_name', 'last_name');
  if (!staff) throw ApiError.notFound('Docente no encontrado.');
  const rows = await trx('teacher_unavailability as u')
    .join('time_slots as ts', 'ts.id', 'u.time_slot_id')
    .where({ 'u.tenant_id': tenantId, 'u.staff_id': staffId, 'ts.school_period_id': periodId })
    .select('u.day_of_week', 'u.time_slot_id', 'u.reason');
  return { teacher: { id: staff.id, name: `${staff.first_name} ${staff.last_name}` }, cells: rows };
}

/**
 * Reemplaza los bloques no disponibles del docente en el año. Devuelve además
 * las clases que el docente YA tiene en esos bloques (no se borran: se avisa).
 */
async function saveUnavailability(trx, tenantId, periodId, staffId, cells) {
  const period = await scheduleService.loadPeriod(trx, tenantId, periodId);
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado.`);
  const { teacher } = await getUnavailability(trx, tenantId, periodId, staffId);
  const slots = await trx('time_slots').where({ tenant_id: tenantId, school_period_id: periodId }).select('id', 'is_break', 'name');
  const slotById = new Map(slots.map((s) => [s.id, s]));
  for (const c of cells) {
    const s = slotById.get(c.timeSlotId);
    if (!s) throw ApiError.badRequest('Hay bloques que no pertenecen a este año escolar.', [{ path: 'cells', message: 'Bloque inválido.' }]);
    if (s.is_break) throw ApiError.badRequest(`${s.name} es un recreo: no hace falta marcarlo.`, [{ path: 'cells', message: 'Recreo.' }]);
  }
  await trx('teacher_unavailability').where({ tenant_id: tenantId, staff_id: staffId }).whereIn('time_slot_id', slots.map((s) => s.id)).delete();
  const unique = [...new Map(cells.map((c) => [`${c.dayOfWeek}|${c.timeSlotId}`, c])).values()];
  if (unique.length) {
    await trx('teacher_unavailability').insert(
      unique.map((c) => ({ tenant_id: tenantId, staff_id: staffId, day_of_week: c.dayOfWeek, time_slot_id: c.timeSlotId, reason: c.reason?.trim() || null }))
    );
  }
  const clashes = unique.length
    ? await trx('class_schedules as cs')
        .join('sections as sec', 'sec.id', 'cs.section_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .join('subjects as sub', 'sub.id', 'cs.subject_id')
        .join('time_slots as ts', 'ts.id', 'cs.time_slot_id')
        .where({ 'cs.tenant_id': tenantId, 'cs.staff_id': staffId, 'sec.school_period_id': periodId })
        .andWhere((q) => unique.forEach((c) => q.orWhere({ 'cs.day_of_week': c.dayOfWeek, 'cs.time_slot_id': c.timeSlotId })))
        .select('cs.day_of_week', 'ts.start_time', 'ts.end_time', 'sub.name as subject_name', 'sec.name as section_name', 'g.name as grade_name')
    : [];
  return {
    teacher,
    cells: unique.length,
    warnings: clashes.map(
      (c) => `${teacher.name} ya tiene ${c.subject_name} en ${c.grade_name} ${c.section_name} el ${cellLabel(c.day_of_week, c)}, que ahora marcaste como no disponible.`
    ),
  };
}

module.exports = { generate, getGeneration, apply, discard, getUnavailability, saveUnavailability, loadInputs };
