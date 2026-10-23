const { ApiError } = require('../../utils/ApiError');

/**
 * Transición de año escolar: copia la estructura académica de un año a otro
 * (nuevo o existente y vacío) en pocos clics.
 *
 * Grados, materias y plan de estudios (grade_subjects) son del colegio, no del
 * año: el año nuevo ya los usa sin copiarlos. Lo que se copia es lo que cuelga
 * de school_period_id. Los alumnos NO se copian: sus inscripciones son el
 * historial del año anterior y se pasan al nuevo con Promoción.
 *
 * Corre en la transacción del request (tenant.middleware: COMMIT al terminar,
 * ROLLBACK ante cualquier error): o se copia todo lo elegido o nada.
 *
 * Lo que ya no es válido hoy NO se copia y se informa (en vez de fallar):
 * docentes inactivos o que ya no son personal docente, materias quitadas del
 * plan de estudios del grado, auxiliares en niveles que ya no los admiten, etc.
 */

const PARTS = ['sections', 'teachers', 'terms', 'evaluationRules', 'timeSlots', 'schedule', 'tuition'];
const REQUIRES = { teachers: ['sections'], schedule: ['sections', 'teachers', 'timeSlots'] };
const PART_LABELS = {
  sections: 'Secciones',
  teachers: 'Asignación de docentes',
  terms: 'Lapsos',
  evaluationRules: 'Reglas de evaluación',
  timeSlots: 'Bloques horarios',
  schedule: 'Horario de clases',
  tuition: 'Mensualidades',
};
const RULE_COLUMNS = ['passing_grade', 'max_failed_subjects', 'term_average_mode', 'grade_rounding'];

const count = async (q) => Number((await q.count('* as n').first()).n);

/** "2025-2026" → "2026-2027"; "Año 2025" → "Año 2026". */
function nextName(name) {
  const bumped = String(name).replace(/\d{4}/g, (y) => String(Number(y) + 1));
  return bumped !== name ? bumped : `${name} (nuevo)`;
}

/** 'YYYY-MM-DD' + 1 año (29-feb → 28-feb). */
function nextYearDate(date) {
  if (!date) return null;
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function loadPeriod(trx, tenantId, id, label = 'Año escolar') {
  const period = await trx('school_periods').where({ id, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound(`${label} no encontrado.`);
  return period;
}

/** Docentes que hoy pueden recibir asignaciones: activos y de tipo docente. */
const eligibleStaff = (trx, tenantId) => trx('staff').where({ tenant_id: tenantId, status: 'active', staff_type: 'teaching' }).select('id');

/** Personal asignado en el año que ya no puede recibir asignaciones (para avisar antes de copiar). */
async function ineligibleTeachers(trx, tenantId, periodId) {
  const sections = trx('sections').where({ tenant_id: tenantId, school_period_id: periodId }).select('id');
  const ids = trx
    .select('staff_id as id')
    .from('teacher_sections')
    .whereIn('section_id', sections)
    .union((q) => q.select('staff_id').from('teacher_subject_sections').whereIn('section_id', trx('sections').where({ school_period_id: periodId }).select('id')))
    .union((q) => q.select('guide_teacher_id').from('sections').where({ school_period_id: periodId }).whereNotNull('guide_teacher_id'));
  return trx('staff')
    .where('tenant_id', tenantId)
    .whereIn('id', ids)
    .andWhere((q) => q.whereNot('status', 'active').orWhereNot('staff_type', 'teaching'))
    .select('id', trx.raw("first_name || ' ' || last_name AS name"), 'status', 'staff_type')
    .orderBy(['first_name', 'last_name']);
}

/** Qué tiene ya el año destino de cada parte (si tiene algo, no se copia encima). */
async function targetContents(trx, tenantId, periodId) {
  const sections = trx('sections').where({ tenant_id: tenantId, school_period_id: periodId }).select('id');
  return {
    sections: await count(trx('sections').where({ tenant_id: tenantId, school_period_id: periodId })),
    timeSlots: await count(trx('time_slots').where({ tenant_id: tenantId, school_period_id: periodId })),
    schedule: await count(trx('class_schedules').whereIn('section_id', sections)),
    tuition: await count(trx('tuition_fees').where({ tenant_id: tenantId, school_period_id: periodId })),
  };
}

/**
 * Vista previa para el asistente: qué hay en el año de origen, qué se usa
 * automáticamente (grados, materias), avisos y nombre/fechas sugeridos.
 */
async function previewRollover(trx, tenantId, sourceId) {
  const source = await loadPeriod(trx, tenantId, sourceId, 'Año escolar de origen');
  const sections = () => trx('sections').where({ tenant_id: tenantId, school_period_id: sourceId }).select('id');

  const counts = {
    sections: await count(trx('sections').where({ tenant_id: tenantId, school_period_id: sourceId })),
    grades_with_sections: Number(
      (await trx('sections').where({ tenant_id: tenantId, school_period_id: sourceId }).countDistinct('grade_id as n').first()).n
    ),
    homeroom_teachers: await count(trx('teacher_sections').whereIn('section_id', sections())),
    subject_teachers: await count(trx('teacher_subject_sections').whereIn('section_id', sections())),
    guide_teachers: await count(trx('sections').where({ tenant_id: tenantId, school_period_id: sourceId }).whereNotNull('guide_teacher_id')),
    terms: await count(trx('terms').where({ tenant_id: tenantId, school_period_id: sourceId })),
    time_slots: await count(trx('time_slots').where({ tenant_id: tenantId, school_period_id: sourceId })),
    schedule_classes: await count(trx('class_schedules').whereIn('section_id', sections())),
    tuition_fees: await count(trx('tuition_fees').where({ tenant_id: tenantId, school_period_id: sourceId })),
    active_students: await count(trx('enrollments').whereIn('section_id', sections()).where('status', 'active')),
  };
  const shared = {
    grades: await count(trx('grades').where({ tenant_id: tenantId })),
    subjects: await count(trx('subjects').where({ tenant_id: tenantId, is_active: true })),
    curriculum: await count(trx('grade_subjects').where({ tenant_id: tenantId })),
    classrooms: await count(trx('classrooms').where({ tenant_id: tenantId })),
  };

  // Años que pueden recibir la copia: no finalizados y sin secciones (ej. creado vacío a mano).
  const candidates = await trx('school_periods as sp')
    .where('sp.tenant_id', tenantId)
    .whereNot('sp.id', sourceId)
    .whereNull('sp.closed_at')
    .whereNotExists(trx('sections as s').whereRaw('s.school_period_id = sp.id'))
    .select('sp.id', 'sp.name', 'sp.start_date', 'sp.end_date')
    .orderBy('sp.name', 'desc');

  return {
    source: { id: source.id, name: source.name, start_date: source.start_date, end_date: source.end_date, closed: Boolean(source.closed_at), is_active: source.is_active },
    rules: Object.fromEntries(RULE_COLUMNS.map((c) => [c, source[c]])),
    counts,
    shared,
    ineligible_teachers: await ineligibleTeachers(trx, tenantId, sourceId),
    suggestion: { name: nextName(source.name), startDate: nextYearDate(source.start_date), endDate: nextYearDate(source.end_date) },
    target_candidates: candidates,
    parts: PARTS,
    requires: REQUIRES,
  };
}

/** Opciones elegidas, con dependencias validadas (el servidor no confía en la interfaz). */
function normalizeOptions(options = {}) {
  const chosen = Object.fromEntries(PARTS.map((p) => [p, Boolean(options[p])]));
  if (!PARTS.some((p) => chosen[p])) throw ApiError.badRequest('Elige al menos un elemento para copiar.', [{ path: 'options', message: 'Nada seleccionado.' }]);
  for (const [part, needs] of Object.entries(REQUIRES)) {
    const missing = chosen[part] ? needs.filter((n) => !chosen[n]) : [];
    if (missing.length) {
      throw ApiError.badRequest(`Para copiar "${PART_LABELS[part]}" también debes copiar: ${missing.map((m) => PART_LABELS[m]).join(', ')}.`, [
        { path: `options.${part}`, message: 'Faltan elementos de los que depende.' },
      ]);
    }
  }
  return chosen;
}

async function resolveTarget(trx, tenantId, source, target, opts) {
  if (target?.periodId) {
    if (target.periodId === source.id) throw ApiError.badRequest('El año de destino debe ser distinto al de origen.');
    const period = await loadPeriod(trx, tenantId, target.periodId, 'Año escolar de destino');
    if (period.closed_at) throw ApiError.unprocessable(`El año ${period.name} está finalizado: no se le puede copiar estructura.`);
    await trx('school_periods').where({ id: period.id }).forUpdate().first();
    const has = await targetContents(trx, tenantId, period.id);
    const busy = Object.keys(has).filter((k) => opts[k] && has[k] > 0);
    if (busy.length) {
      throw ApiError.conflict(
        `El año ${period.name} ya tiene ${busy.map((k) => PART_LABELS[k].toLowerCase()).join(', ')}: no se copia encima para no mezclar datos. Elige otro destino o desmarca esos elementos.`
      );
    }
    return { period, created: false };
  }

  const name = String(target?.name || '').trim();
  if (!name) throw ApiError.badRequest('Escribe el nombre del nuevo año escolar.', [{ path: 'target.name', message: 'Requerido.' }]);
  const dup = await trx('school_periods').where({ tenant_id: tenantId }).whereRaw('lower(name) = ?', [name.toLowerCase()]).first('id');
  if (dup) throw ApiError.conflict(`Ya existe un año escolar llamado "${name}".`, [{ path: 'target.name', message: 'Ya existe.' }]);
  if (target.startDate && target.endDate && target.startDate > target.endDate) {
    throw ApiError.badRequest('La fecha de inicio debe ser anterior a la de fin.', [{ path: 'target.endDate', message: 'Antes del inicio.' }]);
  }
  const [period] = await trx('school_periods')
    .insert({ tenant_id: tenantId, name, start_date: target.startDate || null, end_date: target.endDate || null, is_active: true })
    .returning('*');
  return { period, created: true };
}

async function copyTerms(trx, tenantId, source, target, created) {
  const terms = await trx('terms').where({ tenant_id: tenantId, school_period_id: source.id }).orderBy(['term_number', 'name']);
  const existing = created ? [] : await trx('terms').where({ tenant_id: tenantId, school_period_id: target.id });
  let copied = 0;
  for (const t of terms) {
    const data = { name: t.name, term_number: t.term_number, weight_percent: t.weight_percent, start_date: nextYearDate(t.start_date), end_date: nextYearDate(t.end_date) };
    const match = existing.find((e) => (t.term_number != null && e.term_number === t.term_number) || e.name.toLowerCase() === t.name.toLowerCase());
    if (match) await trx('terms').where({ id: match.id }).update(data);
    else await trx('terms').insert({ tenant_id: tenantId, school_period_id: target.id, ...data });
    copied += 1;
  }
  return copied;
}

/** Igual que createSchoolPeriod: todo año nace con sus 3 lapsos. */
async function defaultTerms(trx, tenantId, periodId) {
  for (const n of [1, 2, 3]) await trx('terms').insert({ tenant_id: tenantId, school_period_id: periodId, name: `Lapso ${n}`, term_number: n });
}

/** Secciones + materias excluidas. Devuelve el mapa sección origen → sección nueva. */
async function copySections(trx, tenantId, source, target, opts, skipped) {
  const rows = await trx('sections').where({ tenant_id: tenantId, school_period_id: source.id });
  if (!rows.length) return new Map();
  const okStaff = new Set((await eligibleStaff(trx, tenantId)).map((s) => s.id));
  const inserted = await trx('sections')
    .insert(
      rows.map((s) => {
        const keepGuide = opts.teachers && s.guide_teacher_id && okStaff.has(s.guide_teacher_id);
        if (opts.teachers && s.guide_teacher_id && !keepGuide) skipped.guide_teachers += 1;
        return {
          tenant_id: tenantId,
          grade_id: s.grade_id,
          school_period_id: target.id,
          classroom_id: s.classroom_id,
          name: s.name,
          max_students: s.max_students,
          guide_teacher_id: keepGuide ? s.guide_teacher_id : null,
        };
      })
    )
    .returning(['id', 'grade_id', 'name']);
  const byKey = new Map(inserted.map((s) => [`${s.grade_id}|${s.name}`, s.id]));
  const map = new Map(rows.map((s) => [s.id, byKey.get(`${s.grade_id}|${s.name}`)]));

  // Materias que no se dictan en cada sección (solo si siguen en el plan del grado).
  const exclusions = await trx('section_subject_exclusions as x')
    .join('grade_subjects as gs', (j) => j.on('gs.grade_id', 'x.grade_id').andOn('gs.subject_id', 'x.subject_id'))
    .whereIn('x.section_id', [...map.keys()])
    .select('x.section_id', 'x.grade_id', 'x.subject_id');
  if (exclusions.length) {
    await trx('section_subject_exclusions').insert(
      exclusions.map((x) => ({ tenant_id: tenantId, section_id: map.get(x.section_id), grade_id: x.grade_id, subject_id: x.subject_id }))
    );
  }
  return map;
}

/** Titular/auxiliar (Inicial y Primaria) y profesor por materia (Secundaria), solo lo que sigue siendo válido. */
async function copyTeachers(trx, tenantId, sectionMap, skipped) {
  const oldIds = [...sectionMap.keys()];
  const homeroomAll = await count(trx('teacher_sections').whereIn('section_id', oldIds));
  const homeroom = await trx('teacher_sections as ts')
    .join('sections as s', 's.id', 'ts.section_id')
    .join('grades as g', 'g.id', 's.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .whereIn('ts.section_id', oldIds)
    .whereIn('ts.staff_id', eligibleStaff(trx, tenantId))
    .where('el.assignment_mode', 'homeroom')
    .andWhere((q) => q.where('ts.role', 'lead').orWhere('el.allows_assistant', true))
    .select('ts.section_id', 'ts.staff_id', 'ts.role');
  if (homeroom.length) {
    await trx('teacher_sections').insert(homeroom.map((t) => ({ tenant_id: tenantId, section_id: sectionMap.get(t.section_id), staff_id: t.staff_id, role: t.role })));
  }
  skipped.homeroom_teachers += homeroomAll - homeroom.length;

  const bySubjectAll = await count(trx('teacher_subject_sections').whereIn('section_id', oldIds));
  const bySubject = await trx('teacher_subject_sections as t')
    .join('grade_subjects as gs', (j) => j.on('gs.grade_id', 't.grade_id').andOn('gs.subject_id', 't.subject_id'))
    .whereIn('t.section_id', oldIds)
    .whereIn('t.staff_id', eligibleStaff(trx, tenantId))
    .whereNotExists(trx('section_subject_exclusions as x').whereRaw('x.section_id = t.section_id AND x.subject_id = t.subject_id'))
    .select('t.section_id', 't.grade_id', 't.subject_id', 't.staff_id');
  if (bySubject.length) {
    await trx('teacher_subject_sections').insert(
      bySubject.map((t) => ({ tenant_id: tenantId, section_id: sectionMap.get(t.section_id), grade_id: t.grade_id, subject_id: t.subject_id, staff_id: t.staff_id }))
    );
  }
  skipped.subject_teachers += bySubjectAll - bySubject.length;
  return homeroom.length + bySubject.length;
}

/** Bloques horarios (+ indisponibilidad de docentes activos). Devuelve el mapa bloque origen → nuevo. */
async function copyTimeSlots(trx, tenantId, source, target) {
  const slots = await trx('time_slots').where({ tenant_id: tenantId, school_period_id: source.id });
  if (!slots.length) return new Map();
  const inserted = await trx('time_slots')
    .insert(slots.map((s) => ({ tenant_id: tenantId, school_period_id: target.id, name: s.name, start_time: s.start_time, end_time: s.end_time, is_break: s.is_break, sort_order: s.sort_order })))
    .returning(['id', 'start_time']);
  const byStart = new Map(inserted.map((s) => [String(s.start_time), s.id]));
  const map = new Map(slots.map((s) => [s.id, byStart.get(String(s.start_time))]));

  const unavailable = await trx('teacher_unavailability')
    .where('tenant_id', tenantId)
    .whereIn('time_slot_id', [...map.keys()])
    .whereIn('staff_id', eligibleStaff(trx, tenantId))
    .select('staff_id', 'day_of_week', 'time_slot_id', 'reason');
  if (unavailable.length) {
    await trx('teacher_unavailability').insert(unavailable.map((u) => ({ tenant_id: tenantId, staff_id: u.staff_id, day_of_week: u.day_of_week, time_slot_id: map.get(u.time_slot_id), reason: u.reason })));
  }
  return map;
}

async function copySchedule(trx, tenantId, sectionMap, slotMap, skipped) {
  const oldIds = [...sectionMap.keys()];
  const all = await count(trx('class_schedules').whereIn('section_id', oldIds));
  const classes = await trx('class_schedules as c')
    .join('time_slots as ts', 'ts.id', 'c.time_slot_id')
    .join('grade_subjects as gs', (j) => j.on('gs.grade_id', 'c.grade_id').andOn('gs.subject_id', 'c.subject_id'))
    .whereIn('c.section_id', oldIds)
    .where('ts.is_break', false)
    .whereIn('c.staff_id', eligibleStaff(trx, tenantId))
    .whereNotExists(trx('section_subject_exclusions as x').whereRaw('x.section_id = c.section_id AND x.subject_id = c.subject_id'))
    .select('c.section_id', 'c.grade_id', 'c.subject_id', 'c.staff_id', 'c.day_of_week', 'c.time_slot_id');
  const rows = classes
    .filter((c) => slotMap.has(c.time_slot_id))
    .map((c) => ({ tenant_id: tenantId, section_id: sectionMap.get(c.section_id), grade_id: c.grade_id, subject_id: c.subject_id, staff_id: c.staff_id, day_of_week: c.day_of_week, time_slot_id: slotMap.get(c.time_slot_id) }));
  for (let i = 0; i < rows.length; i += 500) await trx('class_schedules').insert(rows.slice(i, i + 500));
  skipped.schedule_classes += all - rows.length;
  return rows.length;
}

async function copyTuition(trx, tenantId, source, target) {
  const fees = await trx('tuition_fees').where({ tenant_id: tenantId, school_period_id: source.id });
  if (fees.length) {
    await trx('tuition_fees').insert(fees.map((f) => ({ tenant_id: tenantId, school_period_id: target.id, level_code: f.level_code, amount: f.amount, currency: f.currency, due_day: f.due_day })));
  }
  return fees.length;
}

/**
 * Ejecuta la copia. `target`: { name, startDate?, endDate? } (año nuevo) o
 * { periodId } (año existente sin secciones). `options`: partes a copiar.
 */
async function executeRollover(trx, tenantId, sourceId, { target, options }) {
  const opts = normalizeOptions(options);
  const source = await loadPeriod(trx, tenantId, sourceId, 'Año escolar de origen');
  // Nadie cambia el origen mientras se copia.
  await trx('school_periods').where({ id: source.id }).forShare().first();
  const { period, created } = await resolveTarget(trx, tenantId, source, target, opts);

  const copied = Object.fromEntries(PARTS.map((p) => [p, 0]));
  const skipped = { guide_teachers: 0, homeroom_teachers: 0, subject_teachers: 0, schedule_classes: 0 };

  if (opts.evaluationRules) {
    await trx('school_periods').where({ id: period.id }).update(Object.fromEntries(RULE_COLUMNS.map((c) => [c, source[c]])));
    copied.evaluationRules = 1;
  }
  if (opts.terms) copied.terms = await copyTerms(trx, tenantId, source, period, created);
  else if (created) await defaultTerms(trx, tenantId, period.id);

  let sectionMap = new Map();
  if (opts.sections) {
    sectionMap = await copySections(trx, tenantId, source, period, opts, skipped);
    copied.sections = sectionMap.size;
  }
  if (opts.teachers) {
    const guides = opts.sections ? await count(trx('sections').where({ school_period_id: period.id }).whereNotNull('guide_teacher_id')) : 0;
    copied.teachers = (await copyTeachers(trx, tenantId, sectionMap, skipped)) + guides;
  }
  let slotMap = new Map();
  if (opts.timeSlots) {
    slotMap = await copyTimeSlots(trx, tenantId, source, period);
    copied.timeSlots = slotMap.size;
  }
  if (opts.schedule) copied.schedule = await copySchedule(trx, tenantId, sectionMap, slotMap, skipped);
  if (opts.tuition) copied.tuition = await copyTuition(trx, tenantId, source, period);

  const result = await trx('school_periods').where({ id: period.id }).first();
  return { target: result, created, copied, skipped, options: opts };
}

module.exports = { previewRollover, executeRollover, nextName, nextYearDate, PARTS, REQUIRES };
