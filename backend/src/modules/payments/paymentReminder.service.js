const { notify } = require('../notifications/notify');
const prefs = require('../notifications/notificationPreferences.service');
const exchange = require('./exchangeRate.service');

/**
 * Recordatorio de pagos vencidos (aviso `payment_overdue`, migración 063).
 *
 * Cuota vencida = pendiente, sin pago reportado y con fecha límite pasada (la
 * misma regla que el estado "Vencido" de Pagos). La tarea diaria recuerda
 * cada cuota:
 *   - la primera vez, el día siguiente a su vencimiento (o cuando se activa el aviso);
 *   - luego cada `overdueIntervalDays` días mientras siga impaga;
 *   - como máximo `overdueMaxReminders` veces.
 * Las cuotas que tocan el mismo día se agrupan: UN aviso por familia con todas
 * sus cuotas y el total (en bolívares a la tasa del día, si la cuota está en
 * divisas). Cada envío queda en payment_reminders (cuota, número, fecha).
 */

const MAX_LISTED = 3; // cuotas que se nombran en el aviso (el resto: "y N más")
const num = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const money = (amount, currency) => (currency === 'USD' ? `$${num(amount)}` : currency === 'VES' ? `Bs ${num(amount)}` : `${num(amount)} ${currency}`);
const dm = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);

/** Cuotas vencidas que toca recordar hoy, con cuántos recordatorios llevan. */
async function dueOverdue(trx, tenantId, { intervalDays, maxReminders }) {
  const { rows } = await trx.raw(
    `
    SELECT p.id, p.guardian_id, p.period_label, p.amount::float AS amount, p.currency,
           p.due_date::text AS due_date, (current_date - p.due_date) AS days_overdue,
           s.first_name AS student_first_name,
           COALESCE(r.sent, 0)::int AS sent, r.last_sent::text AS last_sent
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS sent, max(pr.sent_on) AS last_sent
      FROM payment_reminders pr WHERE pr.payment_id = p.id
    ) r ON true
    WHERE p.tenant_id = CAST(:tenantId AS uuid)
      AND p.status = 'pending'
      AND p.reported_at IS NULL
      AND p.due_date < current_date
      AND COALESCE(r.sent, 0) < CAST(:max AS integer)
      AND (r.last_sent IS NULL OR r.last_sent <= current_date - CAST(:interval AS integer))
    ORDER BY p.guardian_id, p.due_date, s.first_name`,
    { tenantId, max: maxReminders, interval: intervalDays }
  );
  return rows;
}

/** Texto del aviso de una familia: sus cuotas vencidas y el total. */
function overdueText(items, vesRate) {
  const totals = new Map();
  for (const p of items) totals.set(p.currency, (totals.get(p.currency) || 0) + p.amount);
  const listed = items
    .slice(0, MAX_LISTED)
    .map((p) => `«${p.period_label}» de ${p.student_first_name} (venció el ${dm(p.due_date)}, ${p.days_overdue} día${p.days_overdue === 1 ? '' : 's'} de atraso)`);
  const more = items.length > MAX_LISTED ? ` y ${items.length - MAX_LISTED} más` : '';
  const total = [...totals].map(([c, a]) => money(a, c)).join(' + ');
  const usd = totals.get('USD');
  const ves = usd && vesRate && totals.size === 1 ? ` (Bs ${num(usd * vesRate)} a la tasa de hoy)` : '';
  const head = items.length === 1 ? 'Tiene una cuota vencida' : `Tiene ${items.length} cuotas vencidas`;
  return `${head}: ${listed.join('; ')}${more}. Total: ${total}${ves}. Puede pagar o reportar su pago en Mis pagos.`;
}

/**
 * Envía los recordatorios del día del colegio. { sent: familias avisadas, payments: cuotas recordadas }.
 */
async function sendOverdueReminders(trx, tenantId) {
  const [bell, email] = await Promise.all([prefs.isEnabled(trx, tenantId, 'payment_overdue', 'bell'), prefs.isEnabled(trx, tenantId, 'payment_overdue', 'email')]);
  if (!bell && !email) return { sent: 0, payments: 0, disabled: true };
  const { overdueIntervalDays: intervalDays, overdueMaxReminders: maxReminders } = await prefs.reminderSettings(trx, tenantId);
  const due = await dueOverdue(trx, tenantId, { intervalDays, maxReminders });
  if (!due.length) return { sent: 0, payments: 0 };

  const vesRate = (await exchange.getEffectiveRate(trx, tenantId, 'VES'))?.rate || null;
  const { rows } = await trx.raw('SELECT current_date::text AS today');
  const { today } = rows[0];
  const byGuardian = new Map();
  for (const p of due) byGuardian.set(p.guardian_id, [...(byGuardian.get(p.guardian_id) || []), p]);

  let sent = 0;
  let payments = 0;
  for (const [guardianId, items] of byGuardian) {
    const body = overdueText(items, vesRate);
    const result = await notify(trx, tenantId, {
      event: 'payment_overdue',
      guardianIds: [guardianId],
      title: items.length === 1 ? 'Recordatorio: cuota vencida' : 'Recordatorio: cuotas vencidas',
      // El aviso admite 500 caracteres: con muchas cuotas, el detalle queda en Mis pagos.
      body: body.length <= 500 ? body : `Tiene ${items.length} cuotas vencidas. Puede verlas y pagar o reportar su pago en Mis pagos.`,
      data: { payment_ids: items.map((p) => p.id), count: items.length },
      links: { guardians: '/payments/mine' },
      linkLabel: 'Ver mis pagos',
      dedupeKey: `payment_overdue:${guardianId}:${today}`,
    });
    if (!result.bell && !result.emails) continue; // ni campana ni correo (p. ej. ya avisado hoy, o sin correo)
    await trx('payment_reminders').insert(
      items.map((p) => ({ tenant_id: tenantId, payment_id: p.id, notification_id: result.bell?.id || null, reminder_number: p.sent + 1, sent_on: today }))
    );
    sent += 1;
    payments += items.length;
  }
  return { sent, payments };
}

module.exports = { sendOverdueReminders, dueOverdue, overdueText };
