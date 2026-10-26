const { ApiError } = require('../../utils/ApiError');
const { notify } = require('../notifications/notify');
const prefs = require('../notifications/notificationPreferences.service');
const teacherScope = require('../access/teacherScope');

/**
 * Citas con padres (migración 042, tabla citas_padres): la administración o la
 * directiva cita a un representante para tratar un tema de uno de sus
 * representados. Cada cita elige sus canales de aviso (campana y/o correo) y
 * aparece en el calendario de eventos del personal y en la cartelera del
 * representante citado.
 */

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
// 'pending' = pendiente de confirmación: así nace toda cita; el representante la confirma desde el portal.
const STATUS_LABELS = { pending: 'Pendiente de confirmación', confirmed: 'Confirmada', completed: 'Concluida', cancelled: 'Cancelada' };
const EVENT = 'parent_meeting';

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const todayStr = () => ymd(new Date());
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dayLabel = (date) => {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Consulta base: cita + representante + alumno (con su grado y sección vigentes) + quién la agendó. */
function baseQuery(trx, tenantId) {
  return trx('citas_padres as c')
    .join('guardians as g', 'g.id', 'c.guardian_id')
    .leftJoin('students as s', 's.id', 'c.student_id')
    .leftJoin('users as u', 'u.id', 'c.created_by')
    .leftJoin('users as cu', 'cu.id', 'c.confirmed_by')
    .where('c.tenant_id', tenantId)
    .select(
      'c.*',
      'g.first_name as guardian_first_name',
      'g.last_name as guardian_last_name',
      'g.email as guardian_email',
      'g.phone as guardian_phone',
      'g.user_id as guardian_user_id',
      's.first_name as student_first_name',
      's.last_name as student_last_name',
      trx.raw(`(SELECT gr.name || ' · Sección ' || sec.name
                FROM enrollments e JOIN sections sec ON sec.id = e.section_id JOIN grades gr ON gr.id = sec.grade_id
                JOIN school_periods sp ON sp.id = sec.school_period_id
                WHERE e.student_id = c.student_id AND e.status = 'active' AND sp.is_active
                ORDER BY sp.start_date DESC NULLS LAST LIMIT 1) AS student_section`),
      trx.raw('COALESCE(u.full_name, u.username) AS created_by_name'),
      trx.raw('COALESCE(cu.full_name, cu.username) AS confirmed_by_name')
    );
}

function shape(r) {
  const date = ymd(r.meeting_date);
  return {
    id: r.id,
    guardian_id: r.guardian_id,
    guardian_name: `${r.guardian_first_name} ${r.guardian_last_name}`,
    guardian_email: r.guardian_email || null,
    guardian_phone: r.guardian_phone || null,
    guardian_has_portal: Boolean(r.guardian_user_id),
    student_id: r.student_id,
    student_name: r.student_id ? `${r.student_first_name} ${r.student_last_name}` : null,
    student_section: r.student_section || null,
    meeting_date: date,
    start_time: hhmm(r.start_time),
    end_time: hhmm(r.end_time),
    location: r.location,
    topic: r.topic,
    notes: r.notes,
    status: r.status,
    status_label: STATUS_LABELS[r.status],
    notify_bell: r.notify_bell,
    notify_email: r.notify_email,
    last_notified_at: r.last_notified_at,
    reminder_count: r.reminder_count ?? 0,
    confirmed_at: r.confirmed_at || null,
    // ¿La confirmó el propio representante (desde el portal) o el personal?
    confirmed_by_guardian: Boolean(r.confirmed_by && r.confirmed_by === r.guardian_user_id),
    confirmed_by_name: r.confirmed_by_name || null,
    created_by_name: r.created_by_name || null,
    created_at: r.created_at,
    is_past: date < todayStr(),
  };
}

/** Próximas primero (por fecha y hora); luego las pasadas, de la más reciente a la más antigua. */
function chronological(a, b) {
  if (a.is_past !== b.is_past) return a.is_past ? 1 : -1;
  const key = (x) => `${x.meeting_date} ${x.start_time}`;
  return a.is_past ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b));
}

/** `scope` del docente con carga restringida: solo citas de alumnos de su carga. */
async function listAppointments(trx, tenantId, { from, to, status, scope = null } = {}) {
  const q = baseQuery(trx, tenantId);
  if (from) q.andWhere('c.meeting_date', '>=', from);
  if (to) q.andWhere('c.meeting_date', '<=', to);
  if (status) q.andWhere('c.status', status);
  if (scope) teacherScope.restrictStudents(q.whereNotNull('c.student_id'), scope, 'c.student_id', { activeOnly: false });
  return (await q).map(shape).sort(chronological);
}

async function load(trx, tenantId, id, scope = null) {
  const q = baseQuery(trx, tenantId).andWhere('c.id', id);
  if (scope) teacherScope.restrictStudents(q.whereNotNull('c.student_id'), scope, 'c.student_id', { activeOnly: false });
  const row = await q.first();
  if (!row) throw ApiError.notFound('Cita no encontrada.');
  return row;
}

const getAppointment = async (trx, tenantId, id, scope = null) => shape(await load(trx, tenantId, id, scope));

/**
 * Datos del formulario: representantes con sus alumnos, los canales de aviso
 * predeterminados (Configuración → Notificaciones) y si el correo está listo.
 */
async function formOptions(trx, tenantId) {
  const guardians = await trx('guardians as g')
    .where('g.tenant_id', tenantId)
    .select(
      'g.id',
      'g.first_name',
      'g.last_name',
      'g.national_id',
      'g.email',
      trx.raw('(g.user_id IS NOT NULL) AS has_portal'),
      trx.raw(`COALESCE((
        SELECT json_agg(json_build_object('id', s.id, 'name', s.first_name || ' ' || s.last_name) ORDER BY sg.is_primary DESC, s.last_name, s.first_name)
        FROM student_guardians sg JOIN students s ON s.id = sg.student_id
        WHERE sg.guardian_id = g.id AND s.status = 'active'
      ), '[]'::json) AS students`)
    )
    .orderBy(['g.last_name', 'g.first_name']);
  // En serie: comparten la conexión de la transacción.
  const bell = await prefs.isEnabled(trx, tenantId, EVENT, 'bell');
  const email = await prefs.isEnabled(trx, tenantId, EVENT, 'email');
  const mail = await prefs.emailStatus(trx, tenantId);
  return { guardians, notify_defaults: { bell, email }, email_ready: Boolean(mail.ready), statuses: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })) };
}

/** El alumno, si se indica, debe ser representado del representante elegido. */
async function assertGuardianStudent(trx, tenantId, guardianId, studentId) {
  const guardian = await trx('guardians').where({ id: guardianId, tenant_id: tenantId }).first('id');
  if (!guardian) throw ApiError.badRequest('El representante no existe.', [{ path: 'guardianId', message: 'Inválido.' }]);
  if (!studentId) return;
  const link = await trx('student_guardians').where({ guardian_id: guardianId, student_id: studentId }).first();
  if (!link) throw ApiError.badRequest('Ese alumno no es representado del representante elegido.', [{ path: 'studentId', message: 'No corresponde.' }]);
}

/**
 * Aviso al representante por los canales elegidos en la cita. Se envía al
 * crearla y cuando cambian su fecha, hora o estado (no al concluirla); el
 * mismo aviso no se repite. Devuelve qué se envió.
 */
async function notifyGuardian(trx, tenantId, appt, { reason, dedupeKey = null, lead = '' }) {
  if (!appt.notify_bell && !appt.notify_email) return { bell: false, emails: 0, reason: 'disabled' };
  if (appt.status === 'completed' || appt.is_past) return { bell: false, emails: 0, reason: 'skipped' };
  const when = `${dayLabel(appt.meeting_date)} ${appt.end_time ? `de ${appt.start_time} a ${appt.end_time}` : `a las ${appt.start_time}`}${appt.location ? `, en ${appt.location}` : ''}`;
  const about = appt.student_name ? ` sobre ${appt.student_name}` : '';
  const titles = { created: 'Cita con el colegio', rescheduled: 'Cita reprogramada', confirmed: 'Cita confirmada', cancelled: 'Cita cancelada', reminder: 'Recordatorio: cita con el colegio' };
  const pending = appt.status === 'pending';
  const body =
    appt.status === 'cancelled'
      ? `Se canceló la cita${about} del ${when}. Motivo de la cita: ${appt.topic}.`
      : `El colegio le cita${about} el ${when}. Tema: ${appt.topic}.${appt.status === 'confirmed' ? ' La cita está confirmada.' : ''}${pending ? ' Por favor, confirme su asistencia en el portal del colegio.' : ''}`;
  const result = await notify(trx, tenantId, {
    event: EVENT,
    channels: { bell: appt.notify_bell, email: appt.notify_email },
    guardianIds: [appt.guardian_id],
    title: titles[appt.status === 'cancelled' ? 'cancelled' : reason] || titles.created,
    body: `${lead}${body}`,
    data: { appointment_id: appt.id, meeting_date: appt.meeting_date },
    // Pendiente: al inicio del portal, donde está el botón "Confirmar".
    links: { guardians: pending ? '/' : '/portal/events', staff: '/appointments' },
    linkLabel: pending ? 'Confirmar en el portal' : 'Ver en la cartelera',
    dedupeKey: dedupeKey || `${EVENT}:${appt.id}:${appt.meeting_date}:${appt.start_time}:${appt.status}`,
  });
  const sent = { bell: Boolean(result.bell), emails: result.emails, reason };
  if (sent.bell || sent.emails) await trx('citas_padres').where({ id: appt.id }).update({ last_notified_at: trx.fn.now() });
  return sent;
}

function assertTimes(start, end) {
  if (end && start && end <= start) {
    throw ApiError.badRequest('La hora de fin debe ser posterior a la de inicio.', [{ path: 'endTime', message: 'Debe ser posterior al inicio.' }]);
  }
}

async function createAppointment(trx, tenantId, userId, data) {
  assertTimes(data.startTime, data.endTime);
  await assertGuardianStudent(trx, tenantId, data.guardianId, data.studentId || null);
  const [row] = await trx('citas_padres')
    .insert({
      tenant_id: tenantId,
      guardian_id: data.guardianId,
      student_id: data.studentId || null,
      meeting_date: data.meetingDate,
      start_time: data.startTime,
      end_time: data.endTime || null,
      location: data.location || null,
      topic: data.topic.trim(),
      notes: data.notes || null,
      // Toda cita nueva queda PENDIENTE DE CONFIRMACIÓN (la confirma el representante).
      status: 'pending',
      notify_bell: data.notifyBell,
      notify_email: data.notifyEmail,
      created_by: userId || null,
    })
    .returning('id');
  const appt = await getAppointment(trx, tenantId, row.id);
  const notified = await notifyGuardian(trx, tenantId, appt, { reason: 'created' });
  return { ...(await getAppointment(trx, tenantId, row.id)), notified };
}

async function updateAppointment(trx, tenantId, id, data, userId = null) {
  const current = shape(await load(trx, tenantId, id));
  const guardianId = data.guardianId ?? current.guardian_id;
  const studentId = data.studentId === undefined ? current.student_id : data.studentId || null;
  assertTimes(data.startTime ?? current.start_time, data.endTime === undefined ? current.end_time : data.endTime);
  if (data.guardianId !== undefined || data.studentId !== undefined) await assertGuardianStudent(trx, tenantId, guardianId, studentId);

  const patch = {
    guardian_id: guardianId,
    student_id: studentId,
    meeting_date: data.meetingDate,
    start_time: data.startTime,
    end_time: data.endTime === undefined ? undefined : data.endTime || null,
    location: data.location === undefined ? undefined : data.location || null,
    topic: data.topic?.trim(),
    notes: data.notes === undefined ? undefined : data.notes || null,
    status: data.status,
    notify_bell: data.notifyBell,
    notify_email: data.notifyEmail,
    updated_at: trx.fn.now(),
  };
  // Confirmada por el personal (p. ej. la familia avisó por teléfono); si deja de estarlo, se limpia.
  if (data.status && data.status !== current.status) {
    if (data.status === 'confirmed') Object.assign(patch, { confirmed_at: trx.fn.now(), confirmed_by: userId });
    else if (current.status === 'confirmed') Object.assign(patch, { confirmed_at: null, confirmed_by: null });
  }
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  await trx('citas_padres').where({ id, tenant_id: tenantId }).update(patch);
  const updated = await getAppointment(trx, tenantId, id);

  // Se avisa si cambió algo que la familia debe saber: otro representante, fecha u hora, o el estado.
  const rescheduled = updated.meeting_date !== current.meeting_date || updated.start_time !== current.start_time || updated.end_time !== current.end_time;
  const statusChanged = updated.status !== current.status;
  let notified = null;
  if (updated.guardian_id !== current.guardian_id) notified = await notifyGuardian(trx, tenantId, updated, { reason: 'created' });
  else if (rescheduled) notified = await notifyGuardian(trx, tenantId, updated, { reason: 'rescheduled' });
  else if (statusChanged && ['confirmed', 'cancelled'].includes(updated.status)) notified = await notifyGuardian(trx, tenantId, updated, { reason: updated.status });
  return { ...(await getAppointment(trx, tenantId, id)), notified };
}

/**
 * "Reenviar aviso": vuelve a avisar al representante por los canales de la cita
 * (campana y/o correo), aunque ya se le haya avisado, y registra la fecha.
 * Solo citas vigentes: ni pasadas, ni concluidas, ni canceladas.
 */
async function resendNotice(trx, tenantId, id) {
  const appt = shape(await load(trx, tenantId, id));
  if (appt.status === 'cancelled' || appt.status === 'completed') {
    throw ApiError.unprocessable(`La cita está ${appt.status_label.toLowerCase()}: no se reenvía el aviso.`);
  }
  if (appt.is_past) throw ApiError.unprocessable('La cita ya pasó: no se reenvía el aviso.');
  if (!appt.notify_bell && !appt.notify_email) {
    throw ApiError.unprocessable('La cita no tiene canales de aviso. Edítala y activa la campana o el correo.');
  }
  if (appt.notify_email && !appt.notify_bell && !appt.guardian_email) {
    throw ApiError.unprocessable(`${appt.guardian_name} no tiene correo registrado. Agrégalo en Representantes o activa el aviso por la campana.`);
  }
  const sent = await notifyGuardian(trx, tenantId, appt, {
    reason: 'reminder',
    // Clave nueva en cada reenvío: el aviso anterior no lo bloquea.
    dedupeKey: `${EVENT}:${appt.id}:reminder:${appt.reminder_count + 1}`,
  });
  if (!sent.bell && !sent.emails) {
    throw ApiError.unprocessable('No se pudo enviar el aviso: revisa los canales de la cita y que el correo del colegio esté configurado (Configuración → Correo).');
  }
  await trx('citas_padres').where({ id }).update({ reminder_count: trx.raw('reminder_count + 1') });
  return { ...(await getAppointment(trx, tenantId, id)), notified: sent };
}

/**
 * Recordatorio automático (tarea diaria, Configuración → Notificaciones →
 * Citas con padres): las citas pendientes o confirmadas cuya fecha cae dentro
 * de los próximos `days` días. Usa los canales de CADA cita; una sola vez por
 * fecha y hora (si se reprograma, se recuerda la nueva). Devuelve cuántas se avisaron.
 */
async function sendMeetingReminders(trx, tenantId, days) {
  if (!days) return { sent: 0, due: 0 };
  const { rows } = await trx.raw("SELECT (now() AT TIME ZONE 'America/Caracas')::date::text AS today, ((now() AT TIME ZONE 'America/Caracas')::date + ?::int)::text AS until", [days]);
  const { today, until } = rows[0];
  const due = (
    await baseQuery(trx, tenantId).whereIn('c.status', ['pending', 'confirmed']).andWhere('c.meeting_date', '>', today).andWhere('c.meeting_date', '<=', until)
  ).map(shape);
  let sent = 0;
  for (const appt of due) {
    const left = Math.round((new Date(`${appt.meeting_date}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
    const result = await notifyGuardian(trx, tenantId, appt, {
      reason: 'reminder',
      lead: left === 1 ? 'Es mañana. ' : `Faltan ${left} días. `,
      dedupeKey: `${EVENT}:${appt.id}:auto_reminder:${appt.meeting_date}:${appt.start_time}`,
    });
    if (result.bell || result.emails) sent += 1;
  }
  return { sent, due: due.length };
}

// ---------------------------------------------------------------------------
// Portal del representante
// ---------------------------------------------------------------------------

/** Representante del usuario del portal (404 si el usuario no es representante). */
async function guardianOfUser(trx, tenantId, userId) {
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id', 'first_name', 'last_name');
  if (!guardian) throw ApiError.notFound('Tu usuario no está vinculado a un representante.');
  return guardian;
}

/** Citas próximas de la familia (sin las canceladas), las pendientes primero. */
async function listMyAppointments(trx, tenantId, userId) {
  if (!(await hasTable(trx))) return [];
  const guardian = await guardianOfUser(trx, tenantId, userId);
  const rows = await baseQuery(trx, tenantId).andWhere('c.guardian_id', guardian.id).whereNot('c.status', 'cancelled').andWhere('c.meeting_date', '>=', todayStr());
  // Lo que ve la familia: sin las notas internas ni quién la agendó.
  return rows
    .map(shape)
    .sort((a, b) => (a.status === 'pending') !== (b.status === 'pending') ? (a.status === 'pending' ? -1 : 1) : chronological(a, b))
    .map(({ notes, created_by_name, guardian_email, guardian_phone, reminder_count, ...a }) => a);
}

/**
 * El representante confirma su asistencia: 'pending' → 'confirmed'. Avisa a la
 * administración por la campana. Confirmar dos veces no falla (queda igual).
 */
async function confirmMyAppointment(trx, tenantId, userId, id) {
  const guardian = await guardianOfUser(trx, tenantId, userId);
  const row = await baseQuery(trx, tenantId).andWhere({ 'c.id': id, 'c.guardian_id': guardian.id }).first();
  if (!row) throw ApiError.notFound('Cita no encontrada.');
  const appt = shape(row);
  if (appt.status === 'confirmed') return { ...appt, already_confirmed: true };
  if (appt.status !== 'pending') throw ApiError.conflict(`La cita está ${appt.status_label.toLowerCase()}: ya no se puede confirmar.`);
  if (appt.is_past) throw ApiError.unprocessable('La cita ya pasó.');

  await trx('citas_padres').where({ id }).update({ status: 'confirmed', confirmed_at: trx.fn.now(), confirmed_by: userId, updated_at: trx.fn.now() });
  const when = `${dayLabel(appt.meeting_date)} a las ${appt.start_time}`;
  await notify(trx, tenantId, {
    event: EVENT,
    staffOnly: true,
    channels: { bell: true, email: false },
    title: 'Cita confirmada por el representante',
    body: `${appt.guardian_name} confirmó la cita del ${when}${appt.student_name ? ` sobre ${appt.student_name}` : ''}. Tema: ${appt.topic}.`,
    data: { appointment_id: id, meeting_date: appt.meeting_date },
    links: { staff: '/appointments' },
    linkLabel: 'Ver citas',
    dedupeKey: `${EVENT}:${id}:confirmed-by-guardian`,
  });
  const updated = shape(await baseQuery(trx, tenantId).andWhere('c.id', id).first());
  const { notes, created_by_name, guardian_email, guardian_phone, reminder_count, ...forGuardian } = updated;
  return forGuardian;
}

async function deleteAppointment(trx, tenantId, id) {
  const appt = await load(trx, tenantId, id);
  await trx('citas_padres').where({ id, tenant_id: tenantId }).delete();
  return { deleted: true, id, topic: appt.topic };
}

// ---------------------------------------------------------------------------
// Calendario de eventos
// ---------------------------------------------------------------------------

/**
 * Una cita con la forma de un evento de la cartelera (categoría "cita"), para
 * el calendario. Solo lectura ahí: se gestiona en el módulo de citas.
 */
function asEvent(a, { forGuardian = false } = {}) {
  return {
    id: `cita:${a.id}`,
    kind: 'appointment',
    appointment_id: a.id,
    title: forGuardian ? `Cita: ${a.topic}` : `Cita con ${a.guardian_name}`,
    category: 'cita',
    description: forGuardian ? null : [a.topic, a.notes].filter(Boolean).join('\n\n'),
    location: a.location,
    event_date: a.meeting_date,
    start_time: a.start_time,
    end_time: a.end_time,
    is_published: true,
    audience: 'appointment',
    audience_label: forGuardian ? 'Usted (cita personal)' : `${a.guardian_name}${a.student_name ? ` · ${a.student_name}${a.student_section ? ` (${a.student_section})` : ''}` : ''}`,
    for_students: forGuardian && a.student_name ? [a.student_name.split(' ')[0]] : [],
    status: a.status,
    status_label: a.status_label,
    topic: a.topic,
    is_past: a.is_past,
  };
}

// La cartelera no debe fallar si la migración 042 aún no se aplicó (mismo criterio que los avisos).
let tableReady = false;
async function hasTable(trx) {
  if (tableReady) return true;
  const { rows } = await trx.raw("SELECT to_regclass('citas_padres') IS NOT NULL AS ok");
  tableReady = rows[0].ok;
  return tableReady;
}

/** Citas del calendario del personal (sin las canceladas). */
async function calendarEvents(trx, tenantId, { from, to, scope = null } = {}) {
  if (!(await hasTable(trx))) return [];
  const list = await listAppointments(trx, tenantId, { from, to, scope });
  return list.filter((a) => a.status !== 'cancelled').map((a) => asEvent(a));
}

/** Citas del representante (usuario del portal) para su cartelera, desde `from`. */
async function portalCalendarEvents(trx, tenantId, userId, { from } = {}) {
  if (!(await hasTable(trx))) return [];
  const rows = await baseQuery(trx, tenantId)
    .andWhere('g.user_id', userId)
    .whereNot('c.status', 'cancelled')
    .modify((q) => from && q.andWhere('c.meeting_date', '>=', from));
  return rows.map(shape).map((a) => asEvent(a, { forGuardian: true }));
}

module.exports = {
  sendMeetingReminders,
  resendNotice,
  listMyAppointments,
  confirmMyAppointment,
  STATUSES,
  listAppointments,
  getAppointment,
  formOptions,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  calendarEvents,
  portalCalendarEvents,
};
