const fs = require('fs');
const path = require('path');
const { ApiError } = require('../../utils/ApiError');
const { generateReceiptPdf } = require('../../services/pdf/receiptGenerator');
const { sendMail } = require('../../services/email/mailer');
const { ensureTuition } = require('./tuition.service');
const exchange = require('./exchangeRate.service');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const { resolveProof } = require('../../services/storage/paymentProofStorage');
const { resolveLogoFile } = require('../../services/storage/logoStorage');

/**
 * Reúne desde la base todo lo que muestra el comprobante (marca del colegio,
 * alumno con cédula y sección, representante, datos y conversión del pago).
 * Se usa al confirmar el pago y al regenerar un comprobante ya emitido.
 */
async function buildReceiptData(trx, tenantId, paymentId) {
  const p = await trx('payments').where({ id: paymentId, tenant_id: tenantId }).first();
  const tenant = await trx('tenants').where({ id: tenantId }).first();
  const settings = await trx('tenant_settings').where({ tenant_id: tenantId }).first();
  const student = await trx('students').where({ id: p.student_id }).first();
  const guardian = await trx('guardians').where({ id: p.guardian_id }).first();

  // Sección: la de la inscripción de la mensualidad, o la activa más reciente del alumno.
  const section = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where('e.student_id', p.student_id)
    .modify((q) => (p.enrollment_id ? q.andWhere('e.id', p.enrollment_id) : q.andWhere('e.status', 'active')))
    .orderByRaw('sp.start_date DESC NULLS LAST')
    .select('g.name as grade_name', 'sec.name as section_name', 'sp.name as period_name')
    .first();

  return {
    tenant: {
      name: tenant.name,
      logoPath: resolveLogoFile(settings?.logo_url),
      primaryColor: settings?.primary_color,
      contactEmail: settings?.contact_email,
      contactPhone: settings?.contact_phone,
    },
    receipt: { id: p.id, issuedAt: p.paid_at || new Date() },
    student: {
      name: `${student.first_name} ${student.last_name}`,
      nationalId: student.national_id,
      section: section ? `${section.grade_name} ${section.section_name}` : null,
      schoolPeriod: section?.period_name || null,
    },
    guardian: { name: `${guardian.first_name} ${guardian.last_name}`, nationalId: guardian.national_id },
    payment: {
      concept: p.period_label,
      kind: p.kind,
      paidOn: p.report_paid_on || p.paid_at,
      method: p.report_method,
      reference: p.report_reference,
      note: p.report_note,
      currency: p.currency,
      amount: Number(p.amount),
      amountVes: p.amount_ves !== null ? Number(p.amount_ves) : null,
      rate: p.exchange_rate !== null ? Number(p.exchange_rate) : null,
      rateDate: p.exchange_rate_date,
    },
    guardianEmail: guardian.email,
    tenantName: tenant.name,
  };
}

/** Genera el PDF, lo guarda en storage/receipts/<id>.pdf y devuelve { buffer, receiptUrl, data }. */
async function generateAndStoreReceipt(trx, tenantId, paymentId) {
  const data = await buildReceiptData(trx, tenantId, paymentId);
  const buffer = await generateReceiptPdf(data);
  const receiptFilename = `${paymentId}.pdf`;
  fs.writeFileSync(path.join(RECEIPTS_DIR, receiptFilename), buffer);
  return { buffer, receiptUrl: `/storage/receipts/${receiptFilename}`, receiptFilename, data };
}

/** Vuelve a generar el comprobante de un pago ya confirmado (p. ej. con el diseño o logo nuevos). */
async function regenerateReceipt(trx, tenantId, paymentId) {
  const payment = await getById(trx, tenantId, paymentId);
  if (payment.status !== 'paid') throw ApiError.conflict('Solo los pagos confirmados tienen comprobante.');
  const { receiptUrl } = await generateAndStoreReceipt(trx, tenantId, paymentId);
  await trx('payments').where({ id: paymentId }).update({ receipt_url: receiptUrl });
  return (await paymentsQuery(trx, tenantId).where('p.id', paymentId))[0];
}

/**
 * Monto en bolívares de cada pago (columnas ves_*):
 *   - confirmado con conversión guardada → la foto de ese momento (no cambia con la tasa);
 *   - cobro en Bs (VES)                  → el monto tal cual;
 *   - pendiente en USD                   → estimado con la tasa BCV VIGENTE hoy.
 * Calculado en SQL (NUMERIC) para no arrastrar errores de punto flotante.
 */
const VES_SELECT = [
  `CASE WHEN p.amount_ves IS NOT NULL THEN p.amount_ves
        WHEN p.currency = 'VES' THEN p.amount
        WHEN cr.rate IS NOT NULL THEN round(p.amount * cr.rate, 2)
   END AS ves_amount`,
  `CASE WHEN p.amount_ves IS NOT NULL THEN p.exchange_rate WHEN p.currency = 'VES' THEN NULL ELSE cr.rate END AS ves_rate`,
  `CASE WHEN p.amount_ves IS NOT NULL THEN p.exchange_rate_date WHEN p.currency = 'VES' THEN NULL ELSE cr.rate_date END AS ves_rate_date`,
  `(p.amount_ves IS NULL AND p.currency <> 'VES') AS ves_estimated`,
];

const RECEIPTS_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

/**
 * Estado que ve el usuario, calculado con la fecha de HOY en cada consulta
 * (zona horaria de la base de datos). Solo `status` se guarda; lo demás deriva:
 *   paid / failed / refunded / cancelled → tal cual
 *   reported   → pendiente, el representante informó que pagó (en revisión)
 *   scheduled  → pendiente, todavía no se emite (mes futuro)
 *   overdue    → pendiente, pasó la fecha límite
 *   pending    → pendiente y exigible
 */
const DISPLAY_STATUS_SQL = `
  CASE
    WHEN p.status <> 'pending' THEN p.status
    WHEN p.reported_at IS NOT NULL THEN 'reported'
    WHEN p.issue_date IS NOT NULL AND p.issue_date > current_date THEN 'scheduled'
    WHEN p.due_date IS NOT NULL AND p.due_date < current_date THEN 'overdue'
    ELSE 'pending'
  END`;

const DISPLAY_STATUSES = ['pending', 'overdue', 'reported', 'scheduled', 'paid', 'failed', 'refunded', 'cancelled'];

/** "Por cobrar": todo lo exigible (pendiente, vencido o reportado), sin meses futuros. */
const DUE_STATUSES = ['pending', 'overdue', 'reported'];

function paymentsQuery(trx, tenantId) {
  return trx('payments as p')
    .join('students as s', 's.id', 'p.student_id')
    .join('guardians as g', 'g.id', 'p.guardian_id')
    .joinRaw(`LEFT JOIN LATERAL (${exchange.effectiveRateSql()}) cr ON true`)
    .where('p.tenant_id', tenantId)
    .select(
      'p.*',
      ...VES_SELECT.map((sql) => trx.raw(sql)),
      trx.raw(`${DISPLAY_STATUS_SQL} AS display_status`),
      // Días de atraso (positivo) o que faltan para vencer (negativo); null si no aplica.
      trx.raw("CASE WHEN p.status = 'pending' AND p.due_date IS NOT NULL THEN current_date - p.due_date END AS days_overdue"),
      's.first_name as student_first_name',
      's.last_name as student_last_name',
      'g.first_name as guardian_first_name',
      'g.last_name as guardian_last_name',
      'g.email as guardian_email'
    );
}

/**
 * Listado de pagos. `status` acepta estados de visualización separados por
 * coma (ej. "pending,overdue") o el atajo "due" (= pendiente + vencido + reportado).
 */
async function listPayments(trx, tenantId, { studentId, guardianId, status, schoolPeriodId, kind } = {}) {
  // El estado de cuenta se completa antes de leerse (idempotente).
  await ensureTuition(trx, tenantId, { studentId, guardianId, schoolPeriodId });

  const query = paymentsQuery(trx, tenantId).orderByRaw(
    'p.due_date ASC NULLS LAST, s.last_name, s.first_name, p.created_at DESC'
  );

  if (studentId) query.andWhere('p.student_id', studentId);
  if (guardianId) query.andWhere('p.guardian_id', guardianId);
  if (schoolPeriodId) query.andWhere('p.school_period_id', schoolPeriodId);
  if (kind) query.andWhere('p.kind', kind);
  if (status) {
    const wanted = status === 'due' ? DUE_STATUSES : status.split(',').filter((s) => DISPLAY_STATUSES.includes(s));
    if (wanted.length) query.whereRaw(`(${DISPLAY_STATUS_SQL}) = ANY(?)`, [wanted]);
  }
  return query;
}

/** Totales por estado de visualización y moneda (para las tarjetas del módulo de pagos). */
async function getSummary(trx, tenantId, { schoolPeriodId } = {}) {
  const { billingIssues } = await ensureTuition(trx, tenantId, { schoolPeriodId });

  const query = trx('payments as p')
    .joinRaw(`LEFT JOIN LATERAL (${exchange.effectiveRateSql()}) cr ON true`)
    .where('p.tenant_id', tenantId)
    .select(trx.raw(`${DISPLAY_STATUS_SQL} AS display_status`), 'p.currency')
    .count('p.id as count')
    .sum('p.amount as total')
    .select(trx.raw(`sum(${VES_SELECT[0].replace(/ AS ves_amount$/, '')}) AS total_ves`))
    .groupByRaw(`1, p.currency`);
  if (schoolPeriodId) query.andWhere('p.school_period_id', schoolPeriodId);
  const rows = await query;

  const summary = Object.fromEntries(DISPLAY_STATUSES.map((s) => [s, { count: 0, amounts: [], total_ves: 0 }]));
  rows.forEach((r) => {
    summary[r.display_status].count += Number(r.count);
    summary[r.display_status].amounts.push({ currency: r.currency, total: Number(r.total) });
    // Equivalente en Bs (null si hay montos en USD sin tasa registrada).
    const bucket = summary[r.display_status];
    bucket.total_ves = r.total_ves === null || bucket.total_ves === null ? null : Math.round((bucket.total_ves + Number(r.total_ves)) * 100) / 100;
  });
  summary.exchange = await exchange.getRateStatus(trx, tenantId);
  // Inscripciones sin mensualidades (falta tarifa, representante o fechas del año).
  summary.billing_issues = billingIssues;
  return summary;
}

/** Rechaza fechas de pago futuras según la fecha de la base de datos (zona horaria del colegio). */
async function assertNotFutureDate(trx, date, field = 'paidOn') {
  if (!date) return;
  const { rows } = await trx.raw('SELECT ?::date > current_date AS future', [date]);
  if (rows[0].future) {
    throw ApiError.badRequest('La fecha de pago no puede ser futura.', [{ path: field, message: 'Fecha futura.' }]);
  }
}

async function getGuardianForUser(trx, tenantId, userId) {
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first();
  if (!guardian) throw ApiError.notFound('No hay un representante asociado a este usuario.');
  return guardian;
}

/**
 * Pagos de los hijos de un representante que inició sesión (vista de padres).
 * No incluye cobros anulados: no son deuda ni historial relevante para el padre.
 */
async function listPaymentsForGuardianUser(trx, tenantId, userId) {
  const guardian = await getGuardianForUser(trx, tenantId, userId);
  const rows = await listPayments(trx, tenantId, { guardianId: guardian.id });
  return rows.filter((p) => p.status !== 'cancelled');
}

/**
 * El representante informa que ya pagó (transferencia, pago móvil…). El pago
 * sigue "pending" (se muestra "reportado") hasta que administración lo
 * confirme con markAsPaid. Solo puede reportar pagos a su nombre.
 */
/**
 * `proof` (opcional): datos de un comprobante YA guardado en disco por el
 * controlador ({ proof_path, proof_mime, proof_original_name, proof_size }).
 * Devuelve `{ payment, replacedProofPath }`: si se reemplazó un comprobante
 * anterior, el controlador lo borra cuando la transacción se confirma.
 */
async function reportPayment(trx, tenantId, userId, paymentId, { method, reference, paidOn, note }, proof = null) {
  await assertNotFutureDate(trx, paidOn);
  const guardian = await getGuardianForUser(trx, tenantId, userId);
  const payment = await trx('payments').where({ id: paymentId, tenant_id: tenantId }).first();
  // 404 (y no 403) para no revelar que existe un pago de otra familia.
  if (!payment || payment.guardian_id !== guardian.id) throw ApiError.notFound('Pago no encontrado.');
  if (payment.status !== 'pending') {
    throw ApiError.conflict(payment.status === 'paid' ? 'Este pago ya fue confirmado.' : 'Este cobro no admite reportes.');
  }

  const [updated] = await trx('payments')
    .where({ id: paymentId })
    .update({
      reported_at: trx.fn.now(),
      report_method: method,
      report_reference: reference || null,
      report_paid_on: paidOn,
      report_note: note || null,
      ...(proof ? { ...proof, proof_uploaded_at: trx.fn.now() } : {}),
    })
    .returning('id');
  const row = (await paymentsQuery(trx, tenantId).where('p.id', updated.id))[0];
  return { payment: row, replacedProofPath: proof && payment.proof_path !== proof.proof_path ? payment.proof_path : null };
}

/** Anula un cobro pendiente (cargo erróneo, alumno exonerado…). Queda en el historial como "anulado". */
async function cancelPayment(trx, tenantId, paymentId) {
  const payment = await getById(trx, tenantId, paymentId);
  if (payment.status !== 'pending') {
    throw ApiError.conflict('Solo se pueden anular cobros pendientes.');
  }
  await trx('payments').where({ id: paymentId }).update({ status: 'cancelled', cancelled_at: trx.fn.now() });
  return (await paymentsQuery(trx, tenantId).where('p.id', paymentId))[0];
}

async function getById(trx, tenantId, id) {
  const payment = await trx('payments').where({ id, tenant_id: tenantId }).first();
  if (!payment) throw ApiError.notFound('Pago no encontrado.');
  return payment;
}

async function registerPayment(trx, tenantId, { studentId, guardianId, periodLabel, amount, currency = 'USD' }) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');

  const guardian = await trx('guardians').where({ id: guardianId, tenant_id: tenantId }).first();
  if (!guardian) throw ApiError.notFound('Representante no encontrado.');

  const link = await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).first();
  if (!link) throw ApiError.badRequest('El representante indicado no está asociado a este alumno.');

  const [payment] = await trx('payments')
    .insert({ tenant_id: tenantId, student_id: studentId, guardian_id: guardianId, period_label: periodLabel, amount, currency })
    .returning('*');
  return payment;
}

/**
 * Marca un pago como exitoso, genera el comprobante en PDF y dispara el
 * correo al representante con el PDF adjunto (requerimiento F: "Envío
 * automático de correo... con el comprobante digital correspondiente").
 *
 * El envío de correo se hace de forma best-effort: si el SMTP falla, el pago
 * igual queda registrado como pagado (el dinero ya se cobró) y se informa el
 * error en la respuesta para que el admin pueda reenviar el comprobante
 * manualmente. En producción esto se movería a una cola (BullMQ/Redis) en
 * vez de enviarse síncrono dentro del request — ver recomendaciones fase 2.
 */
/**
 * `details` (opcional): datos del pago que registra administración
 * { method, reference, paidOn, note }. Si el representante ya lo había
 * reportado, lo que envíe el administrador prevalece (es quien verificó).
 * La tasa BCV se toma de la fecha de pago: la indicada, la reportada o hoy.
 */
async function markAsPaid(trx, tenantId, paymentId, details = {}, proof = null) {
  await assertNotFutureDate(trx, details.paidOn);
  const payment = await getById(trx, tenantId, paymentId);
  if (payment.status === 'paid') {
    throw ApiError.conflict('Este pago ya fue registrado como pagado.');
  }
  if (payment.status === 'cancelled') {
    throw ApiError.conflict('Este cobro está anulado; no se puede registrar como pagado.');
  }

  const student = await trx('students').where({ id: payment.student_id }).first();
  const guardian = await trx('guardians').where({ id: payment.guardian_id }).first();
  const tenant = await trx('tenants').where({ id: tenantId }).first();

  // Datos del pago: los del administrador prevalecen sobre los reportados.
  const paidOn = details.paidOn || payment.report_paid_on || null;
  const paymentData = {};
  if (details.method) paymentData.report_method = details.method;
  if (details.reference !== undefined) paymentData.report_reference = details.reference || null;
  if (details.paidOn) paymentData.report_paid_on = details.paidOn;
  if (details.note !== undefined) paymentData.report_note = details.note || null;
  if (proof) Object.assign(paymentData, proof, { proof_uploaded_at: trx.fn.now() });
  const replacedProofPath = proof && payment.proof_path ? payment.proof_path : null;

  // Tasa de la fecha en que se pagó (indicada, reportada o hoy).
  let rate = null;
  if (payment.currency !== 'VES') {
    rate = await exchange.getEffectiveRate(trx, tenantId, paidOn);
    if (!rate) {
      throw ApiError.unprocessable(
        `No hay tasa BCV registrada vigente para ${paidOn || 'hoy'}. Regístrala antes de confirmar el pago.`
      );
    }
  }

  const paidAt = new Date();
  // amount_ves = round(amount × tasa, 2) calculado en PostgreSQL (NUMERIC exacto).
  await trx('payments')
    .where({ id: paymentId })
    .update({
      ...paymentData,
      status: 'paid',
      paid_at: paidAt,
      exchange_rate: rate ? trx.raw('(SELECT rate FROM exchange_rates WHERE id = ?)', [rate.id]) : null,
      exchange_rate_date: rate ? rate.rate_date : null,
      amount_ves: rate ? trx.raw('round(amount * (SELECT rate FROM exchange_rates WHERE id = ?), 2)', [rate.id]) : trx.raw('amount'),
    });

  // El comprobante se arma leyendo el pago ya actualizado (conversión, método, referencia…).
  const { buffer: pdfBuffer, receiptUrl, receiptFilename } = await generateAndStoreReceipt(trx, tenantId, paymentId);

  let emailSent = false;
  let emailError = null;
  if (guardian.email) {
    try {
      await sendMail({
        to: guardian.email,
        subject: `Comprobante de pago - ${payment.period_label}`,
        html: `
          <p>Estimado(a) ${guardian.first_name},</p>
          <p>Hemos recibido el pago de <strong>${payment.period_label}</strong> por
          ${payment.currency} ${Number(payment.amount).toFixed(2)} para el alumno
          ${student.first_name} ${student.last_name}. Adjuntamos el comprobante.</p>
          <p>${tenant.name}</p>
        `,
        attachments: [{ filename: receiptFilename, content: pdfBuffer, contentType: 'application/pdf' }],
      });
      emailSent = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('No se pudo enviar el correo de comprobante:', err.message);
      emailError = err.message;
    }
  }

  const [finalPayment] = await trx('payments')
    .where({ id: paymentId })
    .update({ receipt_url: receiptUrl, email_sent_at: emailSent ? trx.fn.now() : null })
    .returning('*');

  return { payment: finalPayment, emailSent, emailError, replacedProofPath };
}

/**
 * Comprobante de un pago para descargar. Pueden verlo:
 *   - la familia dueña del pago (representante del usuario = responsable del cobro);
 *   - quien revisa pagos: permiso "confirmar pagos" (approve_payment) o "editar".
 * NO basta con "leer Pagos": contiene datos bancarios de cada familia.
 * 404 (no 403) cuando no corresponde, para no revelar que el pago existe.
 */
async function getProof(trx, tenantId, userId, paymentId) {
  const payment = await trx('payments').where({ id: paymentId, tenant_id: tenantId }).first();
  if (!payment || !payment.proof_path) throw ApiError.notFound('Comprobante no encontrado.');

  const perms = await getEffectivePermissions(trx, tenantId, userId);
  const reviewer = Boolean(perms.payments?.can_update || perms.payments?.extra_actions?.approve_payment);
  let owner = false;
  if (!reviewer) {
    const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first();
    owner = Boolean(guardian && guardian.id === payment.guardian_id);
  }
  if (!reviewer && !owner) throw ApiError.notFound('Comprobante no encontrado.');

  const absolutePath = resolveProof(payment.proof_path);
  if (!absolutePath) throw ApiError.notFound('Comprobante no encontrado.');
  return { absolutePath, mime: payment.proof_mime, name: payment.proof_original_name || 'comprobante' };
}

module.exports = {
  regenerateReceipt,
  getProof,
  DISPLAY_STATUS_SQL,
  VES_SELECT,
  listPayments,
  getSummary,
  listPaymentsForGuardianUser,
  reportPayment,
  cancelPayment,
  getById,
  registerPayment,
  markAsPaid,
};
