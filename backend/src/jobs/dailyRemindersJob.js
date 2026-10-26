const { db, withTenantTransaction } = require('../config/database');
const { msUntilNextRun } = require('../modules/payments/bcvSync.service');
const prefs = require('../modules/notifications/notificationPreferences.service');
const evaluationReminders = require('../modules/schedules/evaluationReminder.service');
const { sendEventReminders } = require('../modules/events/event.service');
const { sendMeetingReminders } = require('../modules/appointments/appointment.service');
const { sendOverdueReminders } = require('../modules/payments/paymentReminder.service');

/**
 * Recordatorios automáticos: tarea DIARIA (Configuración → Notificaciones).
 *
 *   evaluations  evaluaciones de los planes publicados, N días antes (062)
 *   events       eventos publicados de la cartelera, N días antes (063; 0 = no)
 *   meetings     citas con padres pendientes o confirmadas, N días antes (063; 0 = no)
 *   overdue      cuotas vencidas: cada X días, hasta N recordatorios por cuota (063)
 *
 * ACTIVA por defecto (DAILY_REMINDERS=false la desactiva). Corre a la hora
 * DAILY_REMINDERS_TIME (por defecto 07:00, hora de Venezuela) y una vez poco
 * después de arrancar el servidor, por si estuvo apagado a esa hora. Repetirla
 * no duplica avisos: cada uno tiene su clave de deduplicación y los de pagos
 * llevan su propio registro (payment_reminders).
 *
 * Por colegio, una transacción; cada tipo de recordatorio en su propio punto de
 * guardado: si uno falla, los demás del mismo colegio igual salen.
 */
const DEFAULT_TIME = '07:00';

function reminderTime() {
  const t = (process.env.DAILY_REMINDERS_TIME || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : DEFAULT_TIME;
}

const PROCESSORS = {
  evaluations: (trx, tenantId) => evaluationReminders.sendDueReminders(trx, tenantId),
  events: async (trx, tenantId) => sendEventReminders(trx, tenantId, (await prefs.reminderSettings(trx, tenantId)).eventReminderDays),
  meetings: async (trx, tenantId) => sendMeetingReminders(trx, tenantId, (await prefs.reminderSettings(trx, tenantId)).meetingReminderDays),
  overdue: (trx, tenantId) => sendOverdueReminders(trx, tenantId),
};

/** Recordatorios del día de UN colegio: { evaluations: {sent…}, events, meetings, overdue }. */
async function runForTenant(trx, tenantId) {
  const out = {};
  for (const [name, run] of Object.entries(PROCESSORS)) {
    try {
      out[name] = await trx.transaction((sp) => run(sp, tenantId));
    } catch (err) {
      out[name] = { sent: 0, error: err.message };
      console.error(`[recordatorios] ${name} · colegio ${tenantId}:`, err.message);
    }
  }
  return out;
}

let running = false;

async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  const summary = { tenants: 0, sent: 0, byType: {}, errors: 0 };
  try {
    const tenants = await db('tenants').whereIn('status', ['active', 'trial']).pluck('id');
    for (const id of tenants) {
      try {
        const r = await withTenantTransaction(id, (trx) => runForTenant(trx, id));
        summary.tenants += 1;
        for (const [name, res] of Object.entries(r)) {
          summary.byType[name] = (summary.byType[name] || 0) + (res.sent || 0);
          summary.sent += res.sent || 0;
          if (res.error) summary.errors += 1;
        }
      } catch (err) {
        summary.errors += 1;
        console.error(`[recordatorios] Colegio ${id}:`, err.message);
      }
    }
    if (summary.sent) console.log(`[recordatorios] ${summary.sent} recordatorio(s) enviados en ${summary.tenants} colegio(s): ${JSON.stringify(summary.byType)}.`);
    return summary;
  } finally {
    running = false;
  }
}

let timer = null;

function scheduleNext() {
  const ms = msUntilNextRun(new Date(), [reminderTime()]);
  timer = setTimeout(async () => {
    await runOnce().catch((err) => console.error('[recordatorios]', err.message));
    scheduleNext();
  }, ms);
  timer.unref();
  return new Date(Date.now() + ms);
}

function startDailyRemindersJob() {
  if (process.env.DAILY_REMINDERS === 'false') {
    console.log('[recordatorios] Recordatorios automáticos desactivados (DAILY_REMINDERS=false).');
    return null;
  }
  const first = setTimeout(() => runOnce().catch((err) => console.error('[recordatorios]', err.message)), 20 * 1000);
  first.unref();
  const next = scheduleNext();
  console.log(`[recordatorios] Recordatorios diarios (evaluaciones, eventos, citas y pagos vencidos) a las ${reminderTime()} (hora de Venezuela). Próxima: ${next.toISOString()}.`);
  return { next };
}

function stopDailyRemindersJob() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startDailyRemindersJob, stopDailyRemindersJob, runOnce, runForTenant, reminderTime };
