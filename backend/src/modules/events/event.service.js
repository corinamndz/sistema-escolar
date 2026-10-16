const { ApiError } = require('../../utils/ApiError');
const notices = require('../notifications/notices');

/**
 * Cartelera de eventos especiales del colegio (migración 028): actos
 * culturales, eventos familiares, asambleas de padres, reuniones…
 *
 *   - Cada evento tiene UNA fecha con su hora de inicio y (opcional) de fin.
 *   - Va dirigido a todo el colegio, a un grado (todas sus secciones) o a una
 *     sección en particular.
 *   - Los borradores (is_published = false) solo los ve la administración.
 *   - El representante ve en el portal los eventos publicados de todo el
 *     colegio y los dirigidos al grado o la sección de alguno de sus hijos.
 */

const CATEGORIES = ['cultural', 'familiar', 'asamblea', 'deportivo', 'institucional', 'otro'];
const AUDIENCES = ['school', 'grade', 'section'];

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const today = () => ymd(new Date());

/** Consulta base: evento + nombres de su destino (grado / sección y año). */
function eventQuery(trx, tenantId) {
  return trx('school_events as ev')
    .leftJoin('grades as g', 'g.id', 'ev.grade_id')
    .leftJoin('sections as sec', 'sec.id', 'ev.section_id')
    .leftJoin('grades as sg', 'sg.id', 'sec.grade_id')
    .leftJoin('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .leftJoin('users as u', 'u.id', 'ev.created_by')
    .where('ev.tenant_id', tenantId)
    .select(
      'ev.*',
      'g.name as grade_name',
      'sec.name as section_name',
      'sg.id as section_grade_id',
      'sg.name as section_grade_name',
      'sp.name as school_period_name',
      'u.full_name as created_by_username'
    );
}

function audienceLabel(ev) {
  if (ev.audience === 'grade') return `${ev.grade_name} (todas las secciones)`;
  if (ev.audience === 'section') return `${ev.section_grade_name} · Sección ${ev.section_name}`;
  return 'Todo el colegio';
}

/** Forma pública del evento: fecha 'YYYY-MM-DD', horas HH:MM, destino legible y si ya pasó. */
function shape(ev) {
  const { created_by_username: createdBy, ...rest } = ev;
  const date = ymd(ev.event_date);
  return {
    ...rest,
    event_date: date,
    start_time: hhmm(ev.start_time),
    end_time: hhmm(ev.end_time),
    created_by_name: createdBy || null,
    audience_label: audienceLabel(ev),
    is_past: date < today(),
  };
}

/** Próximos primero (por fecha y hora); luego los pasados, del más reciente al más antiguo. */
function chronological(a, b) {
  if (a.is_past !== b.is_past) return a.is_past ? 1 : -1;
  const key = (e) => `${e.event_date} ${e.start_time}`;
  const cmp = a.is_past ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b));
  return cmp || a.title.localeCompare(b.title);
}

/** Restringe a los eventos con fecha dentro de [from, to]. */
function inRange(q, { from, to }) {
  if (from) q.andWhere('ev.event_date', '>=', from);
  if (to) q.andWhere('ev.event_date', '<=', to);
}

/** Administración: todos los eventos (también borradores), en orden cronológico. */
async function listEvents(trx, tenantId, { from, to, category, publishedOnly = false } = {}) {
  const rows = await eventQuery(trx, tenantId)
    .modify((q) => category && q.andWhere('ev.category', category))
    .modify((q) => publishedOnly && q.andWhere('ev.is_published', true))
    .modify((q) => inRange(q, { from, to }));
  return rows.map(shape).sort(chronological);
}

async function loadEvent(trx, tenantId, id) {
  const ev = await eventQuery(trx, tenantId).andWhere('ev.id', id).first();
  if (!ev) throw ApiError.notFound('Evento no encontrado.');
  return ev;
}

async function getEvent(trx, tenantId, id) {
  return shape(await loadEvent(trx, tenantId, id));
}

/**
 * Valida y normaliza el destino: { audience, grade_id, section_id }.
 * Un grado o sección inexistente (o de otro colegio) → 400.
 */
async function resolveAudience(trx, tenantId, { audience = 'school', gradeId, sectionId }) {
  if (audience === 'grade') {
    if (!gradeId) throw ApiError.badRequest('Elige el año o grado al que va dirigido.', [{ path: 'gradeId', message: 'Requerido.' }]);
    const g = await trx('grades').where({ id: gradeId, tenant_id: tenantId }).first();
    if (!g) throw ApiError.badRequest('El grado no existe.', [{ path: 'gradeId', message: 'Inválido.' }]);
    return { audience, grade_id: gradeId, section_id: null };
  }
  if (audience === 'section') {
    if (!sectionId) throw ApiError.badRequest('Elige la sección a la que va dirigido.', [{ path: 'sectionId', message: 'Requerido.' }]);
    const s = await trx('sections').where({ id: sectionId, tenant_id: tenantId }).first();
    if (!s) throw ApiError.badRequest('La sección no existe.', [{ path: 'sectionId', message: 'Inválida.' }]);
    return { audience, grade_id: null, section_id: sectionId };
  }
  return { audience: 'school', grade_id: null, section_id: null };
}

/** La hora de fin, si la hay, debe ser posterior a la de inicio. */
function assertTimeRange(start, end) {
  if (end && start && end <= start) {
    throw ApiError.badRequest('La hora de fin debe ser posterior a la de inicio.', [{ path: 'endTime', message: 'Debe ser posterior al inicio.' }]);
  }
}

async function createEvent(trx, tenantId, userId, data) {
  assertTimeRange(data.startTime, data.endTime);
  const target = await resolveAudience(trx, tenantId, data);
  const [ev] = await trx('school_events')
    .insert({
      tenant_id: tenantId,
      title: data.title.trim(),
      category: data.category || 'institucional',
      description: data.description || null,
      location: data.location || null,
      ...target,
      event_date: data.eventDate,
      start_time: data.startTime,
      end_time: data.endTime || null,
      is_published: data.isPublished ?? true,
      created_by: userId || null,
    })
    .returning('id');
  const created = await getEvent(trx, tenantId, ev.id);
  await notices.schoolEvent(trx, tenantId, created); // avisa a las familias del público
  return created;
}

async function updateEvent(trx, tenantId, id, data) {
  const current = shape(await loadEvent(trx, tenantId, id));
  // Edición parcial: se valida el horario resultante (lo nuevo sobre lo guardado).
  assertTimeRange(data.startTime ?? current.start_time, data.endTime === undefined ? current.end_time : data.endTime);
  const patch = {
    title: data.title?.trim(),
    category: data.category,
    description: data.description === undefined ? undefined : data.description || null,
    location: data.location === undefined ? undefined : data.location || null,
    event_date: data.eventDate,
    start_time: data.startTime,
    end_time: data.endTime === undefined ? undefined : data.endTime || null,
    is_published: data.isPublished,
    updated_at: trx.fn.now(),
  };
  // El destino se recalcula si cambia cualquiera de sus tres campos.
  if (data.audience !== undefined || data.gradeId !== undefined || data.sectionId !== undefined) {
    Object.assign(
      patch,
      await resolveAudience(trx, tenantId, {
        audience: data.audience ?? current.audience,
        gradeId: data.gradeId === undefined ? current.grade_id : data.gradeId,
        sectionId: data.sectionId === undefined ? current.section_id : data.sectionId,
      })
    );
  }
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  await trx('school_events').where({ id, tenant_id: tenantId }).update(patch);
  const updated = await getEvent(trx, tenantId, id);
  // Publicar un borrador o cambiar fecha/hora vuelve a avisar (el mismo aviso no se repite).
  await notices.schoolEvent(trx, tenantId, updated);
  return updated;
}

async function deleteEvent(trx, tenantId, id) {
  const ev = await loadEvent(trx, tenantId, id);
  await trx('school_events').where({ id, tenant_id: tenantId }).delete();
  return { deleted: true, id, title: ev.title };
}

/**
 * Destinos posibles para el formulario: todos los grados y las secciones de
 * los años escolares activos (no finalizados).
 */
async function audienceOptions(trx, tenantId) {
  const grades = await trx('grades as g')
    .leftJoin('education_levels as el', 'el.code', 'g.level_code')
    .where('g.tenant_id', tenantId)
    .orderBy(['el.sort_order', 'g.sort_order', 'g.name'])
    .select('g.id', 'g.name', 'g.level_code');
  const sections = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .leftJoin('education_levels as el', 'el.code', 'g.level_code')
    .where('sec.tenant_id', tenantId)
    .andWhere('sp.is_active', true)
    .whereNull('sp.closed_at')
    .orderBy(['sp.start_date', 'el.sort_order', 'g.sort_order', 'g.name', 'sec.name'])
    .select('sec.id', 'sec.name', 'g.id as grade_id', 'g.name as grade_name', 'sp.name as school_period_name');
  return { grades, sections };
}

// ---------------------------------------------------------------------------
// Portal del representante
// ---------------------------------------------------------------------------

/**
 * Cartelera para un representante: eventos PUBLICADOS de todo el colegio y
 * los dirigidos al grado o la sección (año activo) de alguno de sus hijos.
 * Cada evento dirigido trae `for_students` (a cuáles de sus hijos aplica).
 * `from`: desde qué fecha (por defecto, 60 días atrás, para ver lo reciente).
 */
async function portalEvents(trx, tenantId, userId, { from } = {}) {
  const kids = await trx('student_guardians as sg')
    .join('guardians as gu', 'gu.id', 'sg.guardian_id')
    .join('students as s', 's.id', 'sg.student_id')
    .leftJoin('enrollments as e', function joinEnrollment() {
      this.on('e.student_id', 's.id').andOn(trx.raw("e.status = 'active'"));
    })
    .leftJoin('sections as sec', 'sec.id', 'e.section_id')
    .leftJoin('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'gu.tenant_id': tenantId, 'gu.user_id': userId })
    .andWhere((q) => q.whereNull('sec.id').orWhere('sp.is_active', true))
    .select('s.id', 's.first_name', 'sec.id as section_id', 'sec.grade_id');

  const sectionIds = [...new Set(kids.map((k) => k.section_id).filter(Boolean))];
  const gradeIds = [...new Set(kids.map((k) => k.grade_id).filter(Boolean))];
  const since = from || ymd(new Date(Date.now() - 60 * 86400000));

  const rows = await eventQuery(trx, tenantId)
    .andWhere('ev.is_published', true)
    .andWhere((q) => {
      q.where('ev.audience', 'school');
      if (gradeIds.length) q.orWhere((w) => w.where('ev.audience', 'grade').whereIn('ev.grade_id', gradeIds));
      if (sectionIds.length) q.orWhere((w) => w.where('ev.audience', 'section').whereIn('ev.section_id', sectionIds));
    })
    .modify((q) => inRange(q, { from: since }));

  const namesFor = (ev) => {
    if (ev.audience === 'school') return [];
    const match = ev.audience === 'grade' ? (k) => k.grade_id === ev.grade_id : (k) => k.section_id === ev.section_id;
    return [...new Set(kids.filter(match).map((k) => k.first_name))];
  };
  // El portal no necesita quién lo creó.
  return rows
    .map((r) => {
      const { created_by: _c, created_by_name: _n, ...ev } = shape(r);
      return { ...ev, for_students: namesFor(r) };
    })
    .sort(chronological);
}

module.exports = {
  CATEGORIES,
  AUDIENCES,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  audienceOptions,
  portalEvents,
};
