const fs = require('fs');
const path = require('path');
const { ApiError } = require('../../utils/ApiError');
const { generateReceiptPdf } = require('../../services/pdf/receiptGenerator');
const { sendMail } = require('../../services/email/mailer');

const RECEIPTS_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

async function listPayments(trx, tenantId, { studentId, guardianId, status } = {}) {
  const query = trx('payments as p')
    .join('students as s', 's.id', 'p.student_id')
    .join('guardians as g', 'g.id', 'p.guardian_id')
    .where('p.tenant_id', tenantId)
    .select(
      'p.*',
      's.first_name as student_first_name',
      's.last_name as student_last_name',
      'g.first_name as guardian_first_name',
      'g.last_name as guardian_last_name',
      'g.email as guardian_email'
    )
    .orderBy('p.created_at', 'desc');

  if (studentId) query.andWhere('p.student_id', studentId);
  if (guardianId) query.andWhere('p.guardian_id', guardianId);
  if (status) query.andWhere('p.status', status);
  return query;
}

/** Pagos de los hijos de un representante que inició sesión como usuario (vista de padres). */
async function listPaymentsForGuardianUser(trx, tenantId, userId) {
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first();
  if (!guardian) throw ApiError.notFound('No hay un representante asociado a este usuario.');
  return listPayments(trx, tenantId, { guardianId: guardian.id });
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
async function markAsPaid(trx, tenantId, paymentId) {
  const payment = await getById(trx, tenantId, paymentId);
  if (payment.status === 'paid') {
    throw ApiError.conflict('Este pago ya fue registrado como pagado.');
  }

  const student = await trx('students').where({ id: payment.student_id }).first();
  const guardian = await trx('guardians').where({ id: payment.guardian_id }).first();
  const tenant = await trx('tenants').where({ id: tenantId }).first();
  const settings = await trx('tenant_settings').where({ tenant_id: tenantId }).first();

  const paidAt = new Date();
  const [updated] = await trx('payments')
    .where({ id: paymentId })
    .update({ status: 'paid', paid_at: paidAt })
    .returning('*');

  const pdfBuffer = await generateReceiptPdf({
    tenantName: tenant.name,
    primaryColor: settings?.primary_color,
    studentName: `${student.first_name} ${student.last_name}`,
    guardianName: `${guardian.first_name} ${guardian.last_name}`,
    periodLabel: payment.period_label,
    amount: Number(payment.amount).toFixed(2),
    currency: payment.currency,
    paidAt: paidAt.toLocaleDateString('es-ES'),
    receiptNumber: payment.id,
  });

  const receiptFilename = `${payment.id}.pdf`;
  fs.writeFileSync(path.join(RECEIPTS_DIR, receiptFilename), pdfBuffer);
  const receiptUrl = `/storage/receipts/${receiptFilename}`;

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

  return { payment: finalPayment, emailSent, emailError };
}

module.exports = { listPayments, listPaymentsForGuardianUser, getById, registerPayment, markAsPaid };
