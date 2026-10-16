const { db, withTenantTransaction } = require('../config/database');
const outbox = require('../modules/notifications/emailOutbox.service');

/**
 * Tarea en segundo plano que envía los correos de avisos encolados
 * (email_outbox). Corre cada EMAIL_OUTBOX_INTERVAL_MS (30 s por defecto);
 * EMAIL_OUTBOX_WORKER=false la desactiva.
 */
let running = false;
let timer = null;

async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  const totals = { sent: 0, failed: 0, retried: 0 };
  try {
    const { rows } = await db.raw("SELECT to_regclass('email_outbox') IS NOT NULL AS ok");
    if (!rows[0].ok) return totals;
    const tenants = await db('tenants').whereIn('status', ['active', 'trial']).pluck('id');
    for (const id of tenants) {
      try {
        const r = await outbox.processOutbox(withTenantTransaction, id);
        totals.sent += r.sent;
        totals.failed += r.failed;
        totals.retried += r.retried;
      } catch (err) {
        console.error(`[correo] Error al enviar los avisos del colegio ${id}:`, err.message);
      }
    }
    if (totals.sent || totals.failed) console.log(`[correo] Avisos enviados ${totals.sent}, fallidos ${totals.failed}, por reintentar ${totals.retried}.`);
    return totals;
  } finally {
    running = false;
  }
}

function startEmailOutboxWorker() {
  if (process.env.EMAIL_OUTBOX_WORKER === 'false') return null;
  const ms = Number(process.env.EMAIL_OUTBOX_INTERVAL_MS) || 30000;
  timer = setInterval(() => runOnce().catch((err) => console.error('[correo]', err.message)), ms);
  timer.unref();
  return timer;
}

function stopEmailOutboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startEmailOutboxWorker, stopEmailOutboxWorker, runOnce };
