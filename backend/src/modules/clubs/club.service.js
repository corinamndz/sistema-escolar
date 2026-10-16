const { ApiError } = require('../../utils/ApiError');
const notices = require('../notifications/notices');

/**
 * Clubes y actividades extracurriculares (migración 026).
 *
 *   - Catálogo de clubes del colegio. Además de los clubes registrados, al
 *     inscribir se puede elegir "OTRO" y escribir una actividad nueva: se crea
 *     al vuelo marcada como personalizada (is_custom) y queda en el catálogo.
 *   - Inscripción por año escolar, individual o masiva (varios alumnos a la
 *     vez), respetando el cupo del club. Retirar conserva el historial
 *     (status = withdrawn); volver a inscribir reactiva la misma fila.
 */

const CATEGORIES = ['musica', 'deporte', 'arte', 'ciencia', 'idiomas', 'otro'];
const today = () => new Date().toISOString().slice(0, 10);

/** Clubes con su coordinador y los inscritos (activos) en el año pedido. */
async function listClubs(trx, tenantId, { schoolPeriodId = null, activeOnly = false } = {}) {
  const rows = await trx('clubs as c')
    .leftJoin('staff as st', 'st.id', 'c.coordinator_id')
    .where('c.tenant_id', tenantId)
    .modify((q) => activeOnly && q.andWhere('c.is_active', true))
    .select(
      'c.*',
      trx.raw("NULLIF(concat_ws(' ', st.first_name, st.last_name), '') AS coordinator_name"),
      schoolPeriodId
        ? trx.raw("(SELECT count(*)::int FROM club_memberships m WHERE m.club_id = c.id AND m.school_period_id = ? AND m.status = 'active') AS member_count", [schoolPeriodId])
        : trx.raw('0 AS member_count')
    )
    .orderBy([{ column: 'c.is_active', order: 'desc' }, { column: 'c.name' }]);
  const sessions = await sessionsByClub(trx, tenantId, rows.map((c) => c.id));
  return rows.map((c) => withSessions({ ...c, member_count: Number(c.member_count), is_full: c.capacity ? Number(c.member_count) >= c.capacity : false }, sessions));
}

// ---------------------------------------------------------------------------
// Fechas de sesión (migración 027)
// ---------------------------------------------------------------------------

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));

/** Map clubId → ['YYYY-MM-DD', …] ordenadas. */
async function sessionsByClub(trx, tenantId, clubIds) {
  const map = new Map();
  if (!clubIds.length) return map;
  const rows = await trx('club_sessions').where({ tenant_id: tenantId }).whereIn('club_id', clubIds).orderBy('session_date').select('club_id', 'session_date');
  rows.forEach((r) => {
    if (!map.has(r.club_id)) map.set(r.club_id, []);
    map.get(r.club_id).push(ymd(r.session_date));
  });
  return map;
}

/** Agrega session_dates, la próxima sesión y la hora en formato HH:MM. */
function withSessions(club, sessions, clubId = club.id) {
  const dates = sessions.get(clubId) || [];
  const today = ymd(new Date());
  return {
    ...club,
    start_time: hhmm(club.start_time),
    end_time: hhmm(club.end_time),
    session_dates: dates,
    next_session: dates.find((d) => d >= today) || null,
  };
}

/** Reemplaza las fechas de sesión del club por la lista recibida (sin duplicados). */
async function setSessions(trx, tenantId, clubId, dates) {
  const unique = [...new Set(dates)].sort();
  await trx('club_sessions').where({ tenant_id: tenantId, club_id: clubId }).whereNotIn('session_date', unique.length ? unique : ['1900-01-01']).delete();
  const existing = new Set((await trx('club_sessions').where({ club_id: clubId }).select('session_date')).map((r) => ymd(r.session_date)));
  for (const d of unique.filter((x) => !existing.has(x))) {
    await trx('club_sessions').insert({ tenant_id: tenantId, club_id: clubId, session_date: d });
  }
}

/** Club con sus fechas de sesión (respuesta de crear/editar). */
async function clubWithSessions(trx, tenantId, clubId) {
  const club = await trx('clubs').where({ id: clubId, tenant_id: tenantId }).first();
  return withSessions(club, await sessionsByClub(trx, tenantId, [clubId]));
}

async function loadClub(trx, tenantId, id) {
  const club = await trx('clubs').where({ id, tenant_id: tenantId }).first();
  if (!club) throw ApiError.notFound('Club no encontrado.');
  return club;
}

async function assertCoordinator(trx, tenantId, coordinatorId) {
  if (!coordinatorId) return;
  const st = await trx('staff').where({ id: coordinatorId, tenant_id: tenantId }).first();
  if (!st) throw ApiError.badRequest('El coordinador no existe en el personal.', [{ path: 'coordinatorId', message: 'Inválido.' }]);
}

/** INSERT/UPDATE con mensaje claro si el nombre ya existe (índice único por colegio). */
async function withUniqueName(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw ApiError.conflict('Ya existe un club con ese nombre.', [{ path: 'name', message: 'Nombre repetido.' }]);
    throw err;
  }
}

async function createClub(trx, tenantId, { name, category = 'otro', description, isCustom = false, coordinatorId, scheduleText, capacity, startTime, endTime, sessionDates }) {
  await assertCoordinator(trx, tenantId, coordinatorId);
  // SAVEPOINT: si choca con el índice único, la transacción del request sigue usable.
  return withUniqueName(() =>
    trx.transaction(async (sp) => {
      const [club] = await sp('clubs')
        .insert({
          tenant_id: tenantId,
          name: name.trim(),
          category,
          description: description || null,
          is_custom: Boolean(isCustom),
          coordinator_id: coordinatorId || null,
          schedule_text: scheduleText || null,
          capacity: capacity || null,
          start_time: startTime || null,
          end_time: endTime || null,
        })
        .returning('*');
      if (sessionDates) await setSessions(sp, tenantId, club.id, sessionDates);
      return club;
    })
  );
}

async function updateClub(trx, tenantId, id, data) {
  await loadClub(trx, tenantId, id);
  if (data.coordinatorId) await assertCoordinator(trx, tenantId, data.coordinatorId);
  const patch = {
    name: data.name?.trim(),
    category: data.category,
    description: data.description === undefined ? undefined : data.description || null,
    coordinator_id: data.coordinatorId === undefined ? undefined : data.coordinatorId || null,
    schedule_text: data.scheduleText === undefined ? undefined : data.scheduleText || null,
    capacity: data.capacity === undefined ? undefined : data.capacity || null,
    start_time: data.startTime === undefined ? undefined : data.startTime || null,
    end_time: data.endTime === undefined ? undefined : data.endTime || null,
    is_active: data.isActive,
    updated_at: trx.fn.now(),
  };
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  return withUniqueName(() =>
    trx.transaction(async (sp) => {
      const [club] = await sp('clubs').where({ id, tenant_id: tenantId }).update(patch).returning('*');
      if (data.sessionDates) await setSessions(sp, tenantId, id, data.sessionDates);
      return club;
    })
  );
}

/** Solo se borra un club sin inscripciones; con historial, se desactiva. */
async function deleteClub(trx, tenantId, id) {
  const club = await loadClub(trx, tenantId, id);
  const used = await trx('club_memberships').where({ club_id: id }).first();
  if (used) {
    throw ApiError.conflict(`${club.name} tiene alumnos inscritos (o lo estuvieron): desactívalo en lugar de eliminarlo para conservar el historial.`);
  }
  await trx('clubs').where({ id, tenant_id: tenantId }).delete();
  return { ok: true };
}

/**
 * Club al que se inscribe: el elegido del catálogo o, con la opción "OTRO",
 * uno con el nombre escrito. Si ese nombre ya existe (sin distinguir
 * mayúsculas) se reutiliza; si no, se crea marcado como personalizado.
 */
async function resolveClub(trx, tenantId, { clubId, customName }) {
  if (clubId) return loadClub(trx, tenantId, clubId);
  const name = String(customName || '').trim();
  if (!name) throw ApiError.badRequest('Elige un club o escribe el nombre de la actividad.', [{ path: 'customName', message: 'Requerido.' }]);
  const existing = await trx('clubs').where({ tenant_id: tenantId }).whereRaw('lower(trim(name)) = lower(?)', [name]).first();
  if (existing) return existing;
  return createClub(trx, tenantId, { name, category: 'otro', isCustom: true });
}

async function loadPeriod(trx, tenantId, periodId) {
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado: no admite inscripciones.`);
  return period;
}

/** Alumnos de un club en un año, con su grado y sección de ese año. */
async function listMembers(trx, tenantId, clubId, { schoolPeriodId, includeWithdrawn = false }) {
  await loadClub(trx, tenantId, clubId);
  return trx('club_memberships as m')
    .join('students as s', 's.id', 'm.student_id')
    .leftJoin('enrollments as e', function onEnrollment() {
      this.on('e.student_id', 'm.student_id').andOn('e.status', trx.raw('?', ['active']));
    })
    .leftJoin('sections as sec', function onSection() {
      this.on('sec.id', 'e.section_id').andOn('sec.school_period_id', 'm.school_period_id');
    })
    .leftJoin('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'm.tenant_id': tenantId, 'm.club_id': clubId, 'm.school_period_id': schoolPeriodId })
    .modify((q) => !includeWithdrawn && q.andWhere('m.status', 'active'))
    .distinctOn('m.id')
    .select('m.id', 'm.status', 'm.joined_on', 'm.withdrawn_on', 'm.notes', 's.id as student_id', 's.first_name', 's.last_name', 's.national_id', 'g.name as grade_name', 'sec.name as section_name')
    .orderBy([{ column: 'm.id' }])
    .then((rows) => rows.sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'es')));
}

/**
 * Inscribe uno o varios alumnos en un club para un año escolar.
 *   - Los ya inscritos (activos) se informan como "ya estaban".
 *   - Los retirados vuelven a quedar activos.
 *   - Respeta el cupo: si no alcanza para todos, no inscribe a nadie (422).
 */
async function enroll(trx, tenantId, { clubId, customName, studentIds, schoolPeriodId, notes }) {
  const period = await loadPeriod(trx, tenantId, schoolPeriodId);
  const club = await resolveClub(trx, tenantId, { clubId, customName });
  if (!club.is_active) throw ApiError.unprocessable(`${club.name} está inactivo: actívalo para inscribir alumnos.`);
  // Bloquea el club para que dos inscripciones simultáneas no superen el cupo.
  await trx('clubs').where({ id: club.id }).forUpdate().first();

  const ids = [...new Set(studentIds)];
  const students = await trx('students').where({ tenant_id: tenantId }).whereIn('id', ids).select('id', 'first_name', 'last_name');
  if (students.length !== ids.length) throw ApiError.badRequest('Hay alumnos que no existen.', [{ path: 'studentIds', message: 'Alumno inválido.' }]);

  const current = await trx('club_memberships').where({ club_id: club.id, school_period_id: period.id }).whereIn('student_id', ids);
  const byStudent = new Map(current.map((m) => [m.student_id, m]));
  const already = students.filter((s) => byStudent.get(s.id)?.status === 'active');
  const toReactivate = students.filter((s) => byStudent.get(s.id)?.status === 'withdrawn');
  const toAdd = students.filter((s) => !byStudent.has(s.id));

  if (club.capacity) {
    const active = Number((await trx('club_memberships').where({ club_id: club.id, school_period_id: period.id, status: 'active' }).count('* as n').first()).n);
    const incoming = toAdd.length + toReactivate.length;
    if (active + incoming > club.capacity) {
      const free = Math.max(0, club.capacity - active);
      throw ApiError.unprocessable(
        `${club.name} tiene cupo para ${club.capacity} (quedan ${free} lugar${free === 1 ? '' : 'es'}) y se intentó inscribir a ${incoming}.`,
        [{ path: 'studentIds', message: 'Supera el cupo.' }]
      );
    }
  }

  if (toReactivate.length) {
    await trx('club_memberships')
      .where({ club_id: club.id, school_period_id: period.id })
      .whereIn('student_id', toReactivate.map((s) => s.id))
      .update({ status: 'active', withdrawn_on: null, joined_on: today(), notes: notes || null });
  }
  for (const s of toAdd) {
    await trx('club_memberships').insert({ tenant_id: tenantId, club_id: club.id, student_id: s.id, school_period_id: period.id, notes: notes || null });
  }
  // Avisa a las familias de los recién inscritos (no a los que ya estaban).
  await notices.clubEnrollment(trx, tenantId, { club, students: [...toAdd, ...toReactivate], schoolPeriodId: period.id });
  const name = (s) => `${s.first_name} ${s.last_name}`;
  return {
    club: { id: club.id, name: club.name, is_custom: club.is_custom },
    added: toAdd.length + toReactivate.length,
    already: already.map(name),
  };
}

async function loadMembership(trx, tenantId, id) {
  const m = await trx('club_memberships').where({ id, tenant_id: tenantId }).first();
  if (!m) throw ApiError.notFound('Inscripción no encontrada.');
  return m;
}

/** Retira al alumno del club (se conserva el historial). */
async function withdraw(trx, tenantId, membershipId) {
  const m = await loadMembership(trx, tenantId, membershipId);
  if (m.status === 'withdrawn') return m;
  const [updated] = await trx('club_memberships').where({ id: m.id }).update({ status: 'withdrawn', withdrawn_on: today() }).returning('*');
  return updated;
}

/** Clubes de un alumno (todos los años, el más reciente primero). Para la ficha y el portal. */
async function studentClubs(trx, tenantId, studentId, { activeOnly = false } = {}) {
  return trx('club_memberships as m')
    .join('clubs as c', 'c.id', 'm.club_id')
    .join('school_periods as sp', 'sp.id', 'm.school_period_id')
    .leftJoin('staff as st', 'st.id', 'c.coordinator_id')
    .where({ 'm.tenant_id': tenantId, 'm.student_id': studentId })
    .modify((q) => activeOnly && q.andWhere('m.status', 'active'))
    .select(
      'm.id',
      'm.status',
      'm.joined_on',
      'm.withdrawn_on',
      'c.id as club_id',
      'c.name as club_name',
      'c.category',
      'c.description',
      'c.is_custom',
      'c.schedule_text',
      'c.start_time',
      'c.end_time',
      trx.raw("NULLIF(concat_ws(' ', st.first_name, st.last_name), '') AS coordinator_name"),
      'sp.id as school_period_id',
      'sp.name as school_period_name',
      'sp.is_active as period_active'
    )
    .orderByRaw("sp.start_date DESC NULLS LAST, CASE m.status WHEN 'active' THEN 0 ELSE 1 END, c.name")
    .then(async (rows) => {
      const sessions = await sessionsByClub(trx, tenantId, [...new Set(rows.map((r) => r.club_id))]);
      return rows.map((r) => withSessions(r, sessions, r.club_id));
    });
}

module.exports = { CATEGORIES, clubWithSessions, listClubs, loadClub, loadMembership, createClub, updateClub, deleteClub, listMembers, enroll, withdraw, studentClubs };
