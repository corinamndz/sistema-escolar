const { notify, guardiansOfStudents, guardiansOfSections } = require('./notify');

/**
 * Avisos de cada evento del sistema (salvo la tasa BCV, que arma
 * bcvSync.service con su detalle). Cada uno decide destinatarios y texto; los
 * canales los decide la matriz de Configuración → Notificaciones (notify).
 */

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const dmy = (d) => ymd(d).split('-').reverse().join('/');
/** '2026-10-20' → "martes 20/10" */
const dayLabel = (date) => {
  const d = new Date(`${ymd(date)}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const money = (amount, currency) => `${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))} ${currency}`;
const today = async (trx) => (await trx.raw('SELECT current_date::text AS d')).rows[0].d;

/**
 * Pago confirmado → su representante, por la campana. El correo de este
 * aviso es el comprobante en PDF, que envía payment.service (por eso skipEmail).
 */
async function paymentConfirmed(trx, tenantId, paymentId) {
  const p = await trx('payments as p').join('students as s', 's.id', 'p.student_id').where({ 'p.id': paymentId, 'p.tenant_id': tenantId }).first('p.*', 's.first_name');
  if (!p?.guardian_id) return null;
  const ref = p.ref_amount !== null && p.ref_currency && p.ref_currency !== p.currency ? ` (${money(p.ref_amount, p.ref_currency)})` : '';
  return notify(trx, tenantId, {
    event: 'payment_confirmed',
    guardianIds: [p.guardian_id],
    title: 'Pago confirmado',
    body: `Se confirmó el pago de «${p.period_label}» de ${p.first_name} por ${money(p.amount, p.currency)}${ref}. ¡Gracias! El comprobante está en Mis pagos.`,
    data: { payment_id: p.id },
    links: { guardians: '/payments/mine' },
    linkLabel: 'Ver mis pagos',
    dedupeKey: `payment_confirmed:${p.id}`,
    skipEmail: true,
  });
}

/**
 * Evento de la cartelera publicado (o cambiado de fecha/hora) → las familias
 * del público del evento. Solo eventos por venir.
 */
async function schoolEvent(trx, tenantId, ev) {
  if (!ev.is_published || ev.event_date < (await today(trx))) return null;
  let guardianIds = [];
  const all = ev.audience === 'school';
  if (ev.audience === 'section') guardianIds = await guardiansOfSections(trx, tenantId, [ev.section_id]);
  if (ev.audience === 'grade') {
    const sections = await trx('sections as s')
      .join('school_periods as sp', 'sp.id', 's.school_period_id')
      .where({ 's.tenant_id': tenantId, 's.grade_id': ev.grade_id, 'sp.is_active': true })
      .pluck('s.id');
    guardianIds = await guardiansOfSections(trx, tenantId, sections);
  }
  const time = ev.end_time ? `de ${ev.start_time} a ${ev.end_time}` : `a las ${ev.start_time}`;
  return notify(trx, tenantId, {
    event: 'school_event',
    allGuardians: all,
    guardianIds,
    title: ev.title,
    body: `${dayLabel(ev.event_date)} ${time}${ev.location ? `, en ${ev.location}` : ''}. Dirigido a: ${ev.audience_label}.`,
    data: { event_id: ev.id, event_date: ev.event_date },
    links: { guardians: '/portal/events' },
    linkLabel: 'Ver cartelera',
    dedupeKey: `school_event:${ev.id}:${ev.event_date}:${ev.start_time}`,
  });
}

/** Sanción registrada → los representantes del alumno. */
async function sanction(trx, tenantId, s) {
  return notify(trx, tenantId, {
    event: 'sanction',
    guardianIds: await guardiansOfStudents(trx, tenantId, [s.student_id]),
    title: 'Registro de convivencia',
    body: `Se registró una falta ${String(s.severity_label || s.severity).toLowerCase()} de ${s.first_name || 'su representado'} el ${dmy(s.occurred_on)}: ${s.fault_type}.${s.measure ? ` Medida: ${s.measure}.` : ''}`,
    data: { sanction_id: s.id, student_id: s.student_id },
    links: { guardians: `/portal/students/${s.student_id}?tab=discipline` },
    linkLabel: 'Ver convivencia',
    dedupeKey: `sanction:${s.id}`,
  });
}

/** Alumnos inscritos en un club → los representantes de cada uno (un aviso por alumno). */
async function clubEnrollment(trx, tenantId, { club, students, schoolPeriodId }) {
  const day = await today(trx);
  for (const s of students) {
    await notify(trx, tenantId, {
      event: 'club_enrollment',
      guardianIds: await guardiansOfStudents(trx, tenantId, [s.id]),
      title: 'Inscripción en club',
      body: `${s.first_name} quedó inscrito(a) en «${club.name}».`,
      data: { club_id: club.id, student_id: s.id },
      links: { guardians: `/portal/students/${s.id}?tab=clubs` },
      linkLabel: 'Ver clubes',
      dedupeKey: `club_enrollment:${club.id}:${s.id}:${schoolPeriodId}:${day}`,
    });
  }
}

module.exports = { paymentConfirmed, schoolEvent, sanction, clubEnrollment };
