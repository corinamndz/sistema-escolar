const mailer = require('../../services/email/mailer');

/**
 * Cola de correos de avisos (email_outbox, migración 036).
 *
 * Los avisos por correo se ENCOLAN dentro de la transacción del evento (si el
 * evento se revierte, no sale nada) y los envía la tarea en segundo plano
 * (jobs/emailOutboxWorker), en lotes y con reintentos: un aviso para todo el
 * colegio no demora la pantalla de quien lo publicó.
 * (El comprobante de pago se sigue enviando en el momento, con su PDF.)
 */

const MAX_ATTEMPTS = 3;
const BATCH = 20;

let ready = false;
async function hasTable(trx) {
  if (ready) return true;
  const { rows } = await trx.raw("SELECT to_regclass('email_outbox') IS NOT NULL AS ok");
  ready = rows[0].ok;
  return ready;
}

/**
 * Encola correos: [{ guardianId, to, subject, html, text, eventType, dedupeKey }].
 * Un mismo correo con la misma clave no se encola dos veces. Devuelve cuántos.
 */
async function enqueue(trx, tenantId, messages) {
  if (!messages.length || !(await hasTable(trx))) return 0;
  const rows = messages.map((m) => ({
    tenant_id: tenantId,
    guardian_id: m.guardianId || null,
    event_type: m.eventType,
    to_email: m.to,
    subject: String(m.subject).slice(0, 300),
    html: m.html,
    text: m.text,
    dedupe_key: m.dedupeKey ? String(m.dedupeKey).slice(0, 250) : null,
  }));
  const inserted = await trx('email_outbox').insert(rows).onConflict(['tenant_id', 'dedupe_key']).ignore().returning('id');
  return inserted.length;
}

/** Errores que vale la pena reintentar (red, servidor ocupado…), no los de configuración. */
const retryable = (err) =>
  err.code !== 'MAIL_DISABLED' &&
  (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'GOOGLE_UNREACHABLE', 'GOOGLE_REFRESH'].includes(err.code) || /^4\d\d/.test(String(err.responseCode || '')) || err.status >= 500);

/**
 * Envía lo pendiente de un colegio. Reclama un lote ('sending'), envía y anota
 * cada resultado. `withTenant(tenantId, fn)` abre una transacción del colegio.
 */
async function processOutbox(withTenant, tenantId) {
  const claimed = await withTenant(tenantId, async (trx) => {
    if (!(await hasTable(trx))) return null;
    await trx('email_outbox').where({ tenant_id: tenantId, status: 'sending' }).andWhere('claimed_at', '<', trx.raw("now() - interval '10 minutes'")).update({ status: 'queued' });
    const ids = await trx('email_outbox')
      .where({ tenant_id: tenantId, status: 'queued' })
      .andWhere('next_attempt_at', '<=', trx.fn.now())
      .orderBy('created_at')
      .limit(BATCH)
      .forUpdate()
      .skipLocked()
      .pluck('id');
    if (!ids.length) return null;
    return trx('email_outbox').whereIn('id', ids).update({ status: 'sending', claimed_at: trx.fn.now(), attempts: trx.raw('attempts + 1') }).returning('*');
  });
  if (!claimed) return { sent: 0, failed: 0, retried: 0 };

  const totals = { sent: 0, failed: 0, retried: 0 };
  for (const m of claimed) {
    // Cada envío en su transacción: el correo del colegio se lee en cada uno (si cambia a mitad, se usa el nuevo).
    await withTenant(tenantId, async (trx) => {
      try {
        await mailer.sendMail({ trx, tenantId, to: m.to_email, subject: m.subject, html: m.html, text: m.text });
        await trx('email_outbox').where({ id: m.id }).update({ status: 'sent', sent_at: trx.fn.now(), error: null });
        totals.sent += 1;
      } catch (err) {
        const again = retryable(err) && m.attempts < MAX_ATTEMPTS;
        await trx('email_outbox')
          .where({ id: m.id })
          .update(again ? { status: 'queued', error: String(err.message).slice(0, 500), next_attempt_at: trx.raw("now() + (? * interval '1 minute')", [2 ** m.attempts]) } : { status: 'failed', error: String(err.message).slice(0, 500) });
        totals[again ? 'retried' : 'failed'] += 1;
      }
    });
  }
  return totals;
}

module.exports = { enqueue, processOutbox };
