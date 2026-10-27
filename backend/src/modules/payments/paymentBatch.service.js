const { ApiError } = require('../../utils/ApiError');
const { sendMail, escapeHtml } = require('../../services/email/mailer');
const { resolveProof } = require('../../services/storage/paymentProofStorage');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { notify } = require('../notifications/notify');
const notificationPrefs = require('../notifications/notificationPreferences.service');
const mailLog = require('../notifications/mailLog.service');
const exchange = require('./exchangeRate.service');
const payments = require('./payment.service');

/**
 * Pagos agrupados (migración 064): el representante paga varias cuotas, de uno
 * o varios hijos, en UNA operación con UN comprobante por el total.
 *
 *   reportar  (familia)        crea el pago agrupado y marca sus cuotas como
 *                              reportadas (payments.batch_id)
 *   retirar   (familia)        lo deja sin efecto para corregirlo
 *   aprobar   (administración) confirma TODAS las cuotas en la transacción de la
 *                              petición — cada una con su tasa y su recibo —,
 *                              luego avisa una sola vez con la solvencia de cada alumno
 *   rechazar  (administración) devuelve las cuotas a "por pagar" con el motivo
 *
 * La transacción es la de la petición (tenant.middleware: BEGIN al entrar,
 * COMMIT al responder bien, ROLLBACK ante cualquier error): si una cuota no se
 * puede confirmar (p. ej. falta la tasa de esa fecha), no queda ninguna a medias.
 */

const num = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
const money = (amount, currency) => (currency === 'USD' ? `$${num(amount)}` : currency === 'VES' ? `Bs ${num(amount)}` : `${num(amount)} ${currency}`);
const MAX_ITEMS = 36;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

function batchQuery(trx, tenantId) {
  return trx('payment_batches as b')
    .join('guardians as g', 'g.id', 'b.guardian_id')
    .leftJoin('users as rv', 'rv.id', 'b.reviewed_by')
    .where('b.tenant_id', tenantId)
    .select(
      'b.*',
      trx.raw("g.first_name || ' ' || g.last_name AS guardian_name"),
      'g.email as guardian_email',
      'rv.full_name as reviewed_by_name',
      trx.raw('(SELECT count(DISTINCT p.student_id)::int FROM payment_batch_items i JOIN payments p ON p.id = i.payment_id WHERE i.batch_id = b.id) AS student_count')
    );
}

/** Cuotas del pago agrupado con su alumno y su estado actual. */
async function batchItems(trx, tenantId, batchId) {
  return trx('payment_batch_items as i')
    .join('payments as p', 'p.id', 'i.payment_id')
    .join('students as s', 's.id', 'p.student_id')
    .where({ 'i.batch_id': batchId, 'i.tenant_id': tenantId })
    .select(
      'p.id as payment_id',
      'p.period_label',
      'i.amount',
      'i.currency',
      'p.status',
      'p.due_date',
      'p.ref_amount',
      'p.ref_currency',
      'p.receipt_url',
      's.id as student_id',
      trx.raw("s.first_name || ' ' || s.last_name AS student_name")
    )
    .orderBy([{ column: 's.first_name' }, { column: 'p.due_date' }]);
}

const shape = (b, items) => ({
  ...b,
  base_total: Number(b.base_total),
  ref_total: b.ref_total === null ? null : Number(b.ref_total),
  has_proof: Boolean(b.proof_path),
  proof_path: undefined,
  items: items?.map((i) => ({ ...i, amount: Number(i.amount), ref_amount: i.ref_amount === null ? null : Number(i.ref_amount) })),
});

async function loadBatch(trx, tenantId, id) {
  const b = await batchQuery(trx, tenantId).andWhere('b.id', id).first();
  if (!b) throw ApiError.notFound('Pago agrupado no encontrado.');
  return b;
}

/** ¿Revisa pagos? (confirmar o editar): ve cualquier pago agrupado y su comprobante. */
async function isReviewer(trx, tenantId, userId) {
  const perms = await getEffectivePermissions(trx, tenantId, userId);
  return Boolean(perms.payments?.can_update || perms.payments?.extra_actions?.approve_payment);
}

// ---------------------------------------------------------------------------
// Familia
// ---------------------------------------------------------------------------

/**
 * Cotización del total en una moneda y fecha (lo que pagaría): suma de cada
 * cuota convertida con la tasa de ese día, redondeada como al confirmar.
 */
async function quoteBatch(trx, tenantId, userId, { paymentIds, currency, date }) {
  const guardian = await payments.getGuardianForUser(trx, tenantId, userId);
  const rows = await ownDuePayments(trx, tenantId, guardian.id, paymentIds, { forQuote: true });
  return computeQuote(trx, tenantId, rows, { currency, date });
}

async function computeQuote(trx, tenantId, rows, { currency, date }) {
  await payments.assertNotFutureDate(trx, date, 'date');
  const baseCurrency = assertSameCurrency(rows);
  const refCurrency = await payments.resolveRefCurrency(trx, tenantId, rows[0], currency);
  const rate = await payments.rateForConversion(trx, tenantId, rows[0], refCurrency, date || null);
  const cur = await exchange.getCurrency(trx, refCurrency, tenantId);
  const factor = rate ? rate.rate : 1;
  const items = rows.map((p) => ({ payment_id: p.id, amount: Number(p.amount), ref_amount: Number((Number(p.amount) * factor).toFixed(cur.decimals ?? 2)) }));
  return {
    base_currency: baseCurrency,
    base_total: round2(items.reduce((a, i) => a + i.amount, 0)),
    currency: cur,
    rate: rate ? rate.rate : null,
    rate_date: rate ? rate.rate_date : null,
    amount: Number(items.reduce((a, i) => a + i.ref_amount, 0).toFixed(cur.decimals ?? 2)),
    items,
    estimated: true,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

function assertSameCurrency(rows) {
  const currencies = [...new Set(rows.map((p) => p.currency))];
  if (currencies.length > 1) {
    throw ApiError.unprocessable(`Las cuotas elegidas están en monedas distintas (${currencies.join(', ')}): págalas por separado.`, [
      { path: 'paymentIds', message: 'Monedas distintas.' },
    ]);
  }
  return currencies[0];
}

/**
 * Cuotas del representante, exigibles y libres para agruparse. 404 si alguna no
 * es suya (no se revela que existe); 409 si ya está pagada, anulada o reportada.
 */
async function ownDuePayments(trx, tenantId, guardianId, paymentIds, { forQuote = false } = {}) {
  const ids = [...new Set(paymentIds)];
  const rows = await trx('payments').where({ tenant_id: tenantId }).whereIn('id', ids).forUpdate();
  if (rows.length !== ids.length || rows.some((p) => p.guardian_id !== guardianId)) throw ApiError.notFound('Alguna de las cuotas no existe o no está a tu nombre.');
  const bad = rows.filter((p) => p.status !== 'pending' || (!forQuote && (p.reported_at || p.batch_id)));
  if (bad.length) {
    const why = (p) => (p.status === 'paid' ? 'ya está pagada' : p.status !== 'pending' ? 'está anulada' : p.batch_id ? 'ya está en otro pago agrupado' : 'ya la reportaste por separado');
    throw ApiError.conflict(`No se pueden incluir: ${bad.map((p) => `«${p.period_label}» (${why(p)})`).join(', ')}.`, [{ path: 'paymentIds', message: 'Cuotas no disponibles.' }]);
  }
  return rows;
}

/**
 * POST /payments/batches — la familia reporta un pago por varias cuotas:
 * { paymentIds, method, reference?, paidOn, note?, currency? } + comprobante opcional.
 */
async function createBatch(trx, tenantId, userId, data, proof = null) {
  await payments.assertNotFutureDate(trx, data.paidOn);
  const guardian = await payments.getGuardianForUser(trx, tenantId, userId);
  const rows = await ownDuePayments(trx, tenantId, guardian.id, data.paymentIds);
  if (rows.length > MAX_ITEMS) throw ApiError.badRequest(`Como máximo ${MAX_ITEMS} cuotas por pago agrupado.`);

  // Total estimado en la moneda en que pagó (si falta la tasa, se reporta igual: se aplica al aprobar).
  let quote = null;
  try {
    quote = await computeQuote(trx, tenantId, rows, { currency: data.currency, date: data.paidOn });
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode !== 422 || /monedas distintas/.test(err.message)) throw err;
  }
  const baseCurrency = assertSameCurrency(rows);
  const refCurrency = quote?.currency.code || (await payments.resolveRefCurrency(trx, tenantId, rows[0], data.currency));

  const [batch] = await trx('payment_batches')
    .insert({
      tenant_id: tenantId,
      guardian_id: guardian.id,
      base_currency: baseCurrency,
      base_total: round2(rows.reduce((a, p) => a + Number(p.amount), 0)),
      item_count: rows.length,
      ref_currency: refCurrency,
      ref_total: quote ? quote.amount : null,
      method: data.method,
      reference: data.reference || null,
      paid_on: data.paidOn,
      note: data.note || null,
      reported_by: userId,
      ...(proof ? { ...proof, proof_uploaded_at: trx.fn.now() } : {}),
    })
    .returning('id');
  await trx('payment_batch_items').insert(rows.map((p) => ({ batch_id: batch.id, payment_id: p.id, tenant_id: tenantId, amount: p.amount, currency: p.currency })));
  // Cada cuota se ve "reportada" (con los datos del pago agrupado) mientras se revisa.
  await trx('payments')
    .whereIn('id', rows.map((p) => p.id))
    .update({
      batch_id: batch.id,
      ref_currency: refCurrency,
      reported_at: trx.fn.now(),
      report_method: data.method,
      report_reference: data.reference || null,
      report_paid_on: data.paidOn,
      report_note: data.note || null,
    });
  await notifyStaffNewBatch(trx, tenantId, guardian, rows, baseCurrency, batch.id);
  return getBatch(trx, tenantId, userId, batch.id);
}

/** Aviso a quien gestiona pagos: hay un pago agrupado por revisar (solo campana). */
async function notifyStaffNewBatch(trx, tenantId, guardian, rows, currency, batchId) {
  const students = new Set(rows.map((p) => p.student_id)).size;
  await notify(trx, tenantId, {
    event: 'payment_confirmed',
    staffOnly: true,
    channels: { bell: true, email: false },
    title: 'Pago agrupado por revisar',
    body: `${guardian.first_name} ${guardian.last_name} reportó un pago de ${money(round2(rows.reduce((a, p) => a + Number(p.amount), 0)), currency)} por ${rows.length} cuota${rows.length === 1 ? '' : 's'}${students > 1 ? ` de ${students} alumnos` : ''}.`,
    data: { batch_id: batchId },
    links: { staff: `/payments?lote=${batchId}` },
    linkLabel: 'Revisar pago agrupado',
    dedupeKey: `payment_batch_reported:${batchId}`,
  });
}

/** Pagos agrupados del representante (los más recientes primero). */
async function listMyBatches(trx, tenantId, userId) {
  const guardian = await payments.getGuardianForUser(trx, tenantId, userId);
  const rows = await batchQuery(trx, tenantId).andWhere('b.guardian_id', guardian.id).orderBy('b.reported_at', 'desc').limit(30);
  return Promise.all(rows.map(async (b) => shape(b, await batchItems(trx, tenantId, b.id))));
}

/** POST /payments/batches/:id/withdraw — la familia retira su pago agrupado en revisión (para corregirlo). */
async function withdrawBatch(trx, tenantId, userId, id) {
  const guardian = await payments.getGuardianForUser(trx, tenantId, userId);
  const b = await trx('payment_batches').where({ id, tenant_id: tenantId }).forUpdate().first();
  if (!b || b.guardian_id !== guardian.id) throw ApiError.notFound('Pago agrupado no encontrado.');
  if (b.status !== 'reported') throw ApiError.conflict('Solo se puede retirar un pago agrupado que está en revisión.');
  await releaseItems(trx, id);
  await trx('payment_batches').where({ id }).update({ status: 'withdrawn', updated_at: trx.fn.now() });
  return getBatch(trx, tenantId, userId, id);
}

/** Las cuotas vuelven a "por pagar": sin los datos del reporte agrupado. */
async function releaseItems(trx, batchId) {
  await trx('payments')
    .where({ batch_id: batchId, status: 'pending' })
    .update({ batch_id: null, reported_at: null, report_method: null, report_reference: null, report_paid_on: null, report_note: null });
}

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

/** GET /payments/batches?status=reported — pagos agrupados (por defecto, los en revisión). */
async function listBatches(trx, tenantId, { status = 'reported' } = {}) {
  const rows = await batchQuery(trx, tenantId)
    .modify((q) => status !== 'all' && q.andWhere('b.status', status))
    .orderBy('b.reported_at', status === 'reported' ? 'asc' : 'desc')
    .limit(200);
  return Promise.all(rows.map(async (b) => shape(b, await batchItems(trx, tenantId, b.id))));
}

/** Detalle: la familia dueña o quien lee pagos. */
async function getBatch(trx, tenantId, userId, id) {
  const b = await loadBatch(trx, tenantId, id);
  const perms = await getEffectivePermissions(trx, tenantId, userId);
  if (!perms.payments?.can_read) {
    const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
    if (!guardian || guardian.id !== b.guardian_id) throw ApiError.notFound('Pago agrupado no encontrado.');
  }
  return shape(b, await batchItems(trx, tenantId, id));
}

/** Comprobante del pago agrupado: la familia dueña o quien revisa pagos (404 si no corresponde). */
async function getBatchProof(trx, tenantId, userId, id) {
  const b = await trx('payment_batches').where({ id, tenant_id: tenantId }).first();
  if (!b?.proof_path) throw ApiError.notFound('Comprobante no encontrado.');
  if (!(await isReviewer(trx, tenantId, userId))) {
    const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
    if (!guardian || guardian.id !== b.guardian_id) throw ApiError.notFound('Comprobante no encontrado.');
  }
  const absolutePath = resolveProof(b.proof_path);
  if (!absolutePath) throw ApiError.notFound('Comprobante no encontrado.');
  return { absolutePath, mime: b.proof_mime, name: b.proof_original_name || 'comprobante' };
}

/**
 * POST /payments/batches/:id/approve — confirma TODAS las cuotas del pago
 * agrupado. `details` (opcional, como al registrar un pago): method, reference,
 * paidOn, note, currency; si no se indican, los que reportó la familia.
 */
async function approveBatch(trx, tenantId, userId, id, details = {}) {
  const b = await trx('payment_batches').where({ id, tenant_id: tenantId }).forUpdate().first();
  if (!b) throw ApiError.notFound('Pago agrupado no encontrado.');
  if (b.status !== 'reported') throw ApiError.conflict(`Este pago agrupado ya fue ${b.status === 'approved' ? 'aprobado' : b.status === 'rejected' ? 'rechazado' : 'retirado por la familia'}.`);

  const items = await batchItems(trx, tenantId, id);
  const notPending = items.filter((i) => i.status !== 'pending');
  if (notPending.length) {
    throw ApiError.conflict(`No se puede aprobar: ${notPending.map((i) => `«${i.period_label}» de ${i.student_name} (${i.status === 'paid' ? 'ya pagada' : 'anulada'})`).join(', ')}. Recházalo y pide a la familia que lo reporte de nuevo.`);
  }

  const paymentDetails = {
    method: details.method || b.method,
    reference: details.reference !== undefined ? details.reference : b.reference,
    paidOn: details.paidOn || (b.paid_on instanceof Date ? ymd(b.paid_on) : String(b.paid_on).slice(0, 10)),
    note: details.note !== undefined ? details.note : b.note,
    currency: details.currency || b.ref_currency || undefined,
  };
  // Cada cuota: estado pagado, tasa de la fecha de pago y su recibo PDF (sin aviso propio).
  const receipts = [];
  for (const item of items) {
    const result = await payments.markAsPaid(trx, tenantId, item.payment_id, paymentDetails, null, { batchId: id, silent: true });
    receipts.push({ item, payment: result.payment, pdfBuffer: result.pdfBuffer, filename: result.receiptFilename });
  }

  const refCurrency = receipts[0].payment.ref_currency;
  const refTotal = receipts.every((r) => r.payment.ref_amount !== null) ? receipts.reduce((a, r) => a + Number(r.payment.ref_amount), 0) : null;
  await trx('payment_batches')
    .where({ id })
    .update({
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: trx.fn.now(),
      method: paymentDetails.method,
      reference: paymentDetails.reference || null,
      paid_on: paymentDetails.paidOn,
      note: paymentDetails.note || null,
      ref_currency: refCurrency,
      ref_total: refTotal === null ? null : refTotal.toFixed(2),
      updated_at: trx.fn.now(),
    });

  const solvency = await studentSolvency(trx, tenantId, [...new Set(items.map((i) => i.student_id))]);
  const notice = await notifyApproved(trx, tenantId, { ...b, ref_currency: refCurrency, ref_total: refTotal }, items, solvency);
  const email = await sendBatchReceiptsEmail(trx, tenantId, b, receipts, solvency);
  return { batch: await getBatch(trx, tenantId, userId, id), solvency, notified: Boolean(notice), emailSent: email.sent, emailError: email.error };
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Solvencia de cada alumno tras el pago: cuántas cuotas exigibles le quedan
 * (pendientes, vencidas o reportadas; sin contar meses aún no emitidos).
 */
async function studentSolvency(trx, tenantId, studentIds) {
  const rows = await trx('students as s')
    .where('s.tenant_id', tenantId)
    .whereIn('s.id', studentIds)
    .select(
      's.id as student_id',
      's.first_name',
      's.last_name',
      trx.raw(`(SELECT count(*)::int FROM payments p
                WHERE p.student_id = s.id AND p.status = 'pending'
                  AND (p.issue_date IS NULL OR p.issue_date <= current_date)) AS pending_count`),
      trx.raw(`(SELECT count(*)::int FROM payments p
                WHERE p.student_id = s.id AND p.status = 'pending' AND p.reported_at IS NULL
                  AND p.due_date < current_date) AS overdue_count`)
    )
    .orderBy('s.first_name');
  return rows.map((r) => ({ ...r, solvent: r.pending_count === 0 }));
}

function solvencyText(solvency) {
  const ok = solvency.filter((s) => s.solvent).map((s) => s.first_name);
  const owing = solvency.filter((s) => !s.solvent);
  const parts = [];
  const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}` : list[0]);
  if (ok.length) parts.push(`${names(ok)} ${ok.length === 1 ? 'queda solvente' : 'quedan solventes'}`);
  for (const s of owing) parts.push(`${s.first_name} aún tiene ${s.pending_count} cuota${s.pending_count === 1 ? '' : 's'} por pagar`);
  return parts.length ? `${parts.join('; ')}.` : '';
}

/** Aviso único a la familia: pago confirmado (campana según la matriz «Pago confirmado»). */
async function notifyApproved(trx, tenantId, b, items, solvency) {
  const ref = b.ref_total !== null && b.ref_currency && b.ref_currency !== b.base_currency ? ` (${money(b.ref_total, b.ref_currency)})` : '';
  const listed = items.slice(0, 4).map((i) => `${i.period_label} de ${i.student_name.split(' ')[0]}`);
  const more = items.length > 4 ? ` y ${items.length - 4} más` : '';
  const body = `Se confirmó su pago de ${money(b.base_total, b.base_currency)}${ref} por ${items.length} cuota${items.length === 1 ? '' : 's'}: ${listed.join(', ')}${more}. ${solvencyText(solvency)} Los recibos están en Mis pagos.`;
  const result = await notify(trx, tenantId, {
    event: 'payment_confirmed',
    guardianIds: [b.guardian_id],
    title: 'Pago agrupado confirmado',
    body: body.length <= 500 ? body : `Se confirmó su pago de ${money(b.base_total, b.base_currency)}${ref} por ${items.length} cuotas. ${solvencyText(solvency)}`.slice(0, 500),
    data: { batch_id: b.id, payment_ids: items.map((i) => i.payment_id), solvency: solvency.map(({ student_id, first_name, pending_count, solvent }) => ({ student_id, first_name, pending_count, solvent })) },
    links: { guardians: '/payments/mine' },
    linkLabel: 'Ver mis pagos',
    dedupeKey: `payment_batch_approved:${b.id}`,
    skipEmail: true, // el correo va aparte, con todos los recibos adjuntos
  });
  return result.bell;
}

/** Un solo correo con los recibos PDF de todas las cuotas (si «Pago confirmado» va por correo). */
async function sendBatchReceiptsEmail(trx, tenantId, b, receipts, solvency) {
  if (!(await notificationPrefs.isEnabled(trx, tenantId, 'payment_confirmed', 'email'))) {
    return { sent: false, error: 'el envío por correo de pagos confirmados está desactivado en Configuración → Notificaciones' };
  }
  const guardian = await trx('guardians').where({ id: b.guardian_id }).first();
  if (!guardian?.email) return { sent: false, error: 'El representante no tiene correo registrado.' };
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const subject = `Comprobantes de pago (${receipts.length} cuotas) - ${tenant.name}`;
  const log = { kind: 'payment_receipt', to: guardian.email, toName: `${guardian.first_name} ${guardian.last_name}`, subject, refId: receipts[0].payment.id };
  try {
    await sendMail({
      trx,
      tenantId,
      to: guardian.email,
      subject,
      html: `
        <p>Estimado(a) ${escapeHtml(guardian.first_name)},</p>
        <p>Confirmamos su pago de <strong>${escapeHtml(money(b.base_total, b.base_currency))}</strong> por las siguientes cuotas:</p>
        <ul>${receipts.map((r) => `<li>${escapeHtml(r.item.period_label)} — ${escapeHtml(r.item.student_name)}: ${escapeHtml(money(r.item.amount, r.item.currency))}</li>`).join('')}</ul>
        <p>${escapeHtml(solvencyText(solvency))}</p>
        <p>Adjuntamos un comprobante por cada cuota.</p>
        <p>${escapeHtml(tenant.name)}</p>`,
      attachments: receipts.map((r) => ({ filename: r.filename, content: r.pdfBuffer, contentType: 'application/pdf' })),
    });
    await mailLog.record(trx, tenantId, log);
    await trx('payments').whereIn('id', receipts.map((r) => r.payment.id)).update({ email_sent_at: trx.fn.now() });
    return { sent: true, error: null };
  } catch (err) {
    if (err.code !== 'MAIL_DISABLED') console.error('No se pudo enviar el correo del pago agrupado:', err.message);
    await mailLog.record(trx, tenantId, { ...log, error: err.message });
    return { sent: false, error: err.message };
  }
}

/** POST /payments/batches/:id/reject — { reason }: las cuotas vuelven a "por pagar" y se avisa a la familia. */
async function rejectBatch(trx, tenantId, userId, id, { reason }) {
  const b = await trx('payment_batches').where({ id, tenant_id: tenantId }).forUpdate().first();
  if (!b) throw ApiError.notFound('Pago agrupado no encontrado.');
  if (b.status !== 'reported') throw ApiError.conflict('Solo se puede rechazar un pago agrupado que está en revisión.');
  await releaseItems(trx, id);
  await trx('payment_batches').where({ id }).update({ status: 'rejected', rejection_reason: reason, reviewed_by: userId, reviewed_at: trx.fn.now(), updated_at: trx.fn.now() });
  await notify(trx, tenantId, {
    event: 'payment_confirmed',
    guardianIds: [b.guardian_id],
    channels: { bell: true, email: false },
    title: 'Pago agrupado no aprobado',
    body: `No se pudo aprobar su pago de ${money(b.base_total, b.base_currency)} por ${b.item_count} cuota${b.item_count === 1 ? '' : 's'}. Motivo: ${reason} Las cuotas vuelven a estar por pagar: puede reportarlo de nuevo en Mis pagos.`.slice(0, 500),
    data: { batch_id: id },
    links: { guardians: '/payments/mine' },
    linkLabel: 'Ver mis pagos',
    dedupeKey: `payment_batch_rejected:${id}`,
  });
  return getBatch(trx, tenantId, userId, id);
}

module.exports = { quoteBatch, createBatch, listMyBatches, withdrawBatch, listBatches, getBatch, getBatchProof, approveBatch, rejectBatch, studentSolvency };
