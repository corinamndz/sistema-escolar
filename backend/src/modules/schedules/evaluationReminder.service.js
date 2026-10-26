const { notify } = require('../notifications/notify');
const prefs = require('../notifications/notificationPreferences.service');
const { isContentReviewRequired } = require('../reviews/reviewSettings.service');

/**
 * Recordatorio de evaluación próxima (aviso `evaluation_reminder`, migración 062).
 *
 * La tarea diaria (src/jobs/dailyRemindersJob.js) llama a sendDueReminders
 * por colegio. Se recuerda cada evaluación cuya fecha de aplicación en la
 * sección (activity_section_dates o, si no tiene, planned_date) cae dentro de
 * los próximos N días (N = tenant_settings.evaluation_reminder_days):
 *
 *     hoy < fecha ≤ hoy + N
 *
 * Normalmente eso es "fecha − N = hoy"; la ventana además cubre un día en que
 * el servidor estuvo apagado, un plan aprobado a última hora o un cambio de N.
 * Cada aviso lleva la clave `evaluation_reminder:<actividad>:<alumno>:<fecha>`
 * (dedupe): nunca se repite, y si la evaluación cambia de fecha se recuerda la nueva.
 *
 * Planes: los que ven las familias en el portal. Con la revisión académica
 * activa, solo los APROBADOS por coordinación; sin ella, todos.
 *
 * Un aviso por alumno (a sus representantes), con el enlace a esa materia en su
 * portal; así una familia con dos hijos en la sección recibe uno por cada uno.
 */

const TZ = 'America/Caracas';
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dmy = (d) => d.split('-').reverse().join('/');
const longDate = (d) => `${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${dmy(d)}`;
const whenText = (days) => (days === 1 ? 'mañana' : `en ${days} días`);

/** Evaluaciones con su alumno, a recordar hoy: una fila por (actividad, alumno). */
async function dueEvaluations(trx, tenantId, days, onlyApproved) {
  const { rows } = await trx.raw(
    `
    WITH today AS (SELECT (now() AT TIME ZONE CAST(:tz AS text))::date AS d)
    SELECT a.id AS activity_id, a.title, ep.subject_id,
           COALESCE(sub.name, ep.subject) AS subject_name,
           eps.section_id,
           COALESCE(asd.applied_on, a.planned_date)::text AS eval_date,
           (COALESCE(asd.applied_on, a.planned_date) - today.d) AS days_left,
           s.id AS student_id, s.first_name, s.last_name
    FROM evaluation_activities a
    JOIN evaluation_plans ep           ON ep.id = a.evaluation_plan_id
    JOIN evaluation_plan_sections eps  ON eps.plan_id = ep.id
    LEFT JOIN activity_section_dates asd ON asd.activity_id = a.id AND asd.section_id = eps.section_id
    LEFT JOIN subjects sub             ON sub.id = ep.subject_id
    JOIN enrollments e                 ON e.section_id = eps.section_id AND e.status = 'active'
    JOIN students s                    ON s.id = e.student_id
    CROSS JOIN today
    WHERE a.tenant_id = CAST(:tenantId AS uuid)
      AND (NOT CAST(:onlyApproved AS boolean) OR ep.review_status = 'aprobado')
      AND COALESCE(asd.applied_on, a.planned_date) >  today.d
      AND COALESCE(asd.applied_on, a.planned_date) <= today.d + CAST(:days AS integer)
    ORDER BY eval_date, subject_name, a.title, s.last_name, s.first_name`,
    { tz: TZ, tenantId, onlyApproved, days }
  );
  return rows;
}

/**
 * Emite los recordatorios del día del colegio. Devuelve un resumen:
 * { days, evaluations, students, sent } (`sent` = avisos nuevos en la campana;
 * los ya enviados no se repiten). Sin campana ni correo activos, no hace nada.
 */
async function sendDueReminders(trx, tenantId) {
  const [bell, email] = await Promise.all([prefs.isEnabled(trx, tenantId, 'evaluation_reminder', 'bell'), prefs.isEnabled(trx, tenantId, 'evaluation_reminder', 'email')]);
  const days = await prefs.evaluationReminderDays(trx, tenantId);
  if (!bell && !email) return { days, evaluations: 0, students: 0, sent: 0, disabled: true };

  const due = await dueEvaluations(trx, tenantId, days, await isContentReviewRequired(trx, tenantId));
  if (!due.length) return { days, evaluations: 0, students: 0, sent: 0 };

  // Representantes de cada alumno, en una sola consulta.
  const links = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('g.tenant_id', tenantId)
    .whereIn('sg.student_id', [...new Set(due.map((r) => r.student_id))])
    .select('sg.student_id', 'sg.guardian_id');
  const guardiansOf = new Map();
  for (const l of links) guardiansOf.set(l.student_id, [...(guardiansOf.get(l.student_id) || []), l.guardian_id]);

  let sent = 0;
  for (const r of due) {
    const guardianIds = guardiansOf.get(r.student_id);
    if (!guardianIds?.length) continue;
    const student = `${r.first_name} ${r.last_name}`;
    const daysLeft = Number(r.days_left);
    const { bell: created } = await notify(trx, tenantId, {
      event: 'evaluation_reminder',
      guardianIds,
      title: 'Recordatorio de evaluación',
      body: `Recordatorio: Su representado ${student} tiene la evaluación «${r.title}» de la cátedra ${r.subject_name} programada para el ${longDate(r.eval_date)} (${whenText(daysLeft)}).`,
      data: { activity_id: r.activity_id, student_id: r.student_id, subject_id: r.subject_id, section_id: r.section_id, date: r.eval_date, days_left: daysLeft },
      links: { guardians: `/portal/students/${r.student_id}?materia=${r.subject_id}` },
      linkLabel: 'Ver evaluaciones',
      dedupeKey: `evaluation_reminder:${r.activity_id}:${r.student_id}:${r.eval_date}`,
    });
    if (created) sent += 1;
  }
  return { days, evaluations: new Set(due.map((r) => `${r.activity_id}:${r.section_id}`)).size, students: new Set(due.map((r) => r.student_id)).size, sent };
}

module.exports = { sendDueReminders, dueEvaluations };
