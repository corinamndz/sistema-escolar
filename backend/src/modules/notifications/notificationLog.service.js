const { ApiError } = require('../../utils/ApiError');
const mailer = require('../../services/email/mailer');
const { CATALOG } = require('./notificationPreferences.service');
const payments = require('../payments/payment.service');

/**
 * Log de notificaciones (Administración): historial de lo que el colegio
 * envió, de tres fuentes, con la misma forma de fila:
 *   bell    campana (notifications)
 *   outbox  avisos por correo encolados (email_outbox)
 *   mail    correos directos: credenciales y comprobantes (mail_log, migración 043)
 * Cada registro se puede reenviar (salvo las credenciales: su contraseña
 * temporal no se guarda). El reenvío queda como un registro nuevo enlazado
 * al original (`resend_of`).
 */

const SOURCES = ['bell', 'outbox', 'mail'];
const PER_SOURCE = 400;
const TYPE_LABELS = {
  ...Object.fromEntries(CATALOG.map((e) => [e.key, e.label])),
  credentials: 'Credenciales de acceso',
  payment_receipt: 'Comprobante de pago',
};
const STATUS_LABELS = { sent: 'Enviado', delivered: 'Publicado', pending: 'Pendiente', retrying: 'Reintentando', failed: 'Fallido' };

const typeLabel = (t) => TYPE_LABELS[t] || t;

/** Estado de una fila de la cola, para el log. */
function outboxStatus(r) {
  if (r.status === 'sent') return 'sent';
  if (r.status === 'failed') return 'failed';
  return r.attempts > 0 && r.error ? 'retrying' : 'pending';
}

async function bellRows(trx, tenantId, since) {
  const rows = await trx('notifications as n')
    .where('n.tenant_id', tenantId)
    .modify((q) => since && q.andWhere('n.created_at', '>=', since))
    .select('n.*', trx.raw('(SELECT count(*)::int FROM notification_reads r WHERE r.notification_id = n.id) AS reads'))
    .orderBy('n.created_at', 'desc')
    .limit(PER_SOURCE);
  const ids = [...new Set(rows.flatMap((r) => r.target_guardian_ids || []))];
  const names = new Map(
    ids.length ? (await trx('guardians').whereIn('id', ids).select('id', trx.raw("first_name || ' ' || last_name AS name"))).map((g) => [g.id, g.name]) : []
  );
  return rows.map((r) => {
    const targets = r.target_guardian_ids || [];
    let recipient;
    if (targets.length) {
      const list = targets.map((id) => names.get(id) || 'Representante eliminado');
      recipient = list.length > 2 ? `${list.slice(0, 2).join(', ')} y ${list.length - 2} más` : list.join(', ');
    } else {
      recipient = [r.audience.includes('guardians') && 'Todas las familias', r.audience.includes('staff') && 'Administración'].filter(Boolean).join(' y ');
    }
    return {
      id: `bell:${r.id}`,
      source: 'bell',
      row_id: r.id,
      channel: 'bell',
      type: r.type,
      type_label: typeLabel(r.type),
      subject: r.title,
      body: r.body,
      recipient,
      recipient_detail: targets.length > 1 ? `${targets.length} representantes` : null,
      status: 'delivered',
      error: null,
      attempts: null,
      reads: r.reads,
      created_at: r.created_at,
      sent_at: r.created_at,
      resend_of: r.resend_of || null,
      resendable: true,
      resend_hint: 'Vuelve a publicarla en la campana (como no leída).',
    };
  });
}

async function outboxRows(trx, tenantId, since) {
  const rows = await trx('email_outbox as o')
    .leftJoin('guardians as g', 'g.id', 'o.guardian_id')
    .where('o.tenant_id', tenantId)
    .modify((q) => since && q.andWhere('o.created_at', '>=', since))
    .select('o.id', 'o.event_type', 'o.subject', 'o.to_email', 'o.status', 'o.attempts', 'o.error', 'o.created_at', 'o.sent_at', 'o.resend_of', trx.raw("g.first_name || ' ' || g.last_name AS guardian_name"))
    .orderBy('o.created_at', 'desc')
    .limit(PER_SOURCE);
  return rows.map((r) => {
    const status = outboxStatus(r);
    return {
      id: `outbox:${r.id}`,
      source: 'outbox',
      row_id: r.id,
      channel: 'email',
      type: r.event_type,
      type_label: typeLabel(r.event_type),
      subject: r.subject,
      body: null,
      recipient: r.guardian_name || r.to_email,
      recipient_detail: r.guardian_name ? r.to_email : null,
      status,
      error: r.error,
      attempts: r.attempts,
      reads: null,
      created_at: r.created_at,
      sent_at: r.sent_at,
      resend_of: r.resend_of || null,
      resendable: status === 'sent' || status === 'failed',
      resend_hint: status === 'sent' || status === 'failed' ? 'Envía de nuevo el mismo correo ahora.' : 'Está en la cola de envío: se enviará en unos minutos.',
    };
  });
}

async function mailRows(trx, tenantId, since) {
  const rows = await trx('mail_log')
    .where('tenant_id', tenantId)
    .modify((q) => since && q.andWhere('created_at', '>=', since))
    .orderBy('created_at', 'desc')
    .limit(PER_SOURCE);
  return rows.map((r) => ({
    id: `mail:${r.id}`,
    source: 'mail',
    row_id: r.id,
    channel: 'email',
    type: r.kind,
    type_label: typeLabel(r.kind),
    subject: r.subject,
    body: null,
    recipient: r.to_name || r.to_email,
    recipient_detail: r.to_name ? r.to_email : null,
    status: r.status,
    error: r.error,
    attempts: null,
    reads: null,
    created_at: r.created_at,
    sent_at: r.status === 'sent' ? r.created_at : null,
    resend_of: r.resend_of || null,
    resendable: r.kind === 'payment_receipt' && Boolean(r.ref_id),
    resend_hint:
      r.kind === 'credentials'
        ? 'Por seguridad la contraseña temporal no se guarda: genera un acceso nuevo desde la ficha del representante o del personal.'
        : 'Regenera el comprobante en PDF y lo envía de nuevo al representante.',
  }));
}

/** `days`: solo lo de los últimos N días (null = todo, hasta PER_SOURCE por fuente). */
async function listLog(trx, tenantId, { days = 90 } = {}) {
  const since = days ? new Date(Date.now() - days * 86400000) : null;
  const all = [...(await bellRows(trx, tenantId, since)), ...(await outboxRows(trx, tenantId, since)), ...(await mailRows(trx, tenantId, since))];
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return all.map((r) => ({ ...r, status_label: STATUS_LABELS[r.status] }));
}

// ---------------------------------------------------------------------------
// Reenvío
// ---------------------------------------------------------------------------

async function resendBell(trx, tenantId, id) {
  const n = await trx('notifications').where({ id, tenant_id: tenantId }).first();
  if (!n) throw ApiError.notFound('Notificación no encontrada.');
  const [copy] = await trx('notifications')
    .insert({
      tenant_id: tenantId,
      type: n.type,
      title: n.title,
      body: n.body,
      data: JSON.stringify({ ...(n.data || {}), resent: true }),
      audience: n.audience,
      ...(n.target_guardian_ids ? { target_guardian_ids: n.target_guardian_ids } : {}),
      resend_of: n.id,
    })
    .returning('id');
  return { ok: true, id: `bell:${copy.id}`, message: 'Notificación publicada de nuevo en la campana.' };
}

/** Reenvía AHORA el mismo correo de la cola y lo anota como un registro nuevo (enviado o fallido). */
async function resendOutbox(trx, tenantId, id, userId) {
  const m = await trx('email_outbox').where({ id, tenant_id: tenantId }).first();
  if (!m) throw ApiError.notFound('Correo no encontrado.');
  if (m.status === 'queued' || m.status === 'sending') {
    throw ApiError.conflict('Este correo todavía está en la cola de envío: se enviará en unos minutos.');
  }
  let error = null;
  try {
    await mailer.sendMail({ trx, tenantId, to: m.to_email, subject: m.subject, html: m.html, text: m.text });
  } catch (err) {
    error = err.message;
  }
  const [copy] = await trx('email_outbox')
    .insert({
      tenant_id: tenantId,
      guardian_id: m.guardian_id,
      event_type: m.event_type,
      to_email: m.to_email,
      subject: m.subject,
      html: m.html,
      text: m.text,
      status: error ? 'failed' : 'sent',
      attempts: 1,
      error: error ? String(error).slice(0, 500) : null,
      sent_at: error ? null : trx.fn.now(),
      resend_of: m.id,
      created_by: userId,
    })
    .returning('id');
  return error
    ? { ok: false, id: `outbox:${copy.id}`, message: `No se pudo reenviar: ${error}` }
    : { ok: true, id: `outbox:${copy.id}`, message: `Correo reenviado a ${m.to_email}.` };
}

async function resendMail(trx, tenantId, id, userId) {
  const r = await trx('mail_log').where({ id, tenant_id: tenantId }).first();
  if (!r) throw ApiError.notFound('Correo no encontrado.');
  if (r.kind === 'credentials') {
    throw ApiError.unprocessable(
      'Las credenciales no se pueden reenviar: por seguridad su contraseña temporal no se guarda. Genera un acceso nuevo desde la ficha del representante o del personal.'
    );
  }
  const payment = r.ref_id ? await trx('payments').where({ id: r.ref_id, tenant_id: tenantId }).first() : null;
  if (!payment || payment.status !== 'paid') throw ApiError.conflict('El pago ya no está confirmado: no hay comprobante para reenviar.');
  const { sent, error } = await payments.sendReceiptEmail(trx, tenantId, payment.id, { resendOf: r.id, userId });
  return sent ? { ok: true, message: `Comprobante reenviado a ${r.to_email}.` } : { ok: false, message: `No se pudo reenviar: ${error}` };
}

async function resend(trx, tenantId, { source, id, userId }) {
  if (source === 'bell') return resendBell(trx, tenantId, id);
  if (source === 'outbox') return resendOutbox(trx, tenantId, id, userId);
  return resendMail(trx, tenantId, id, userId);
}

module.exports = { SOURCES, listLog, resend };
