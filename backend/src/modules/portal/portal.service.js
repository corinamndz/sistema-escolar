const { listGuardianStudents } = require('../students/student.service');
const { DISPLAY_STATUS_SQL, VES_SELECT } = require('../payments/payment.service');
const exchange = require('../payments/exchangeRate.service');
const { ensureTuition } = require('../payments/tuition.service');

/**
 * Panel del representante (portal de padres): sus datos, sus alumnos con
 * grado/sección actual y un resumen de pagos por alumno.
 *
 * Todo se resuelve a partir del usuario autenticado (`guardians.user_id`),
 * nunca de un id que mande el cliente: un representante solo puede ver lo suyo.
 * Los pagos considerados son los registrados a su nombre (mismo criterio que
 * GET /payments/mine).
 *
 * "Por pagar" = exigible hoy (pendiente, vencido o reportado). Las mensualidades
 * de meses futuros ("programadas") y las anuladas no cuentan como deuda.
 */
async function getGuardianPortal(trx, tenantId, userId) {
  const guardian = await trx('guardians')
    .where({ tenant_id: tenantId, user_id: userId })
    .select('id', 'first_name', 'last_name', 'email', 'phone')
    .first();
  if (!guardian) return { guardian: null, students: [], totals: null, billing_issues: [] };

  // Completa los meses que falten antes de leer (ej. tarifa cargada después de
  // inscribir). Lo que no se pudo facturar se devuelve en `billing_issues`.
  const { billingIssues } = await ensureTuition(trx, tenantId, { guardianId: guardian.id });

  const students = await listGuardianStudents(trx, guardian.id);
  const studentIds = students.map((s) => s.id);

  const payments = studentIds.length
    ? await trx('payments as p')
        .where({ 'p.tenant_id': tenantId, 'p.guardian_id': guardian.id })
        .whereIn('p.student_id', studentIds)
        .whereNot('p.status', 'cancelled')
        .joinRaw(`LEFT JOIN LATERAL (${exchange.effectiveRateSql()}) cr ON true`)
        .select(
          trx.raw(VES_SELECT[0]),
          'p.id',
          'p.student_id',
          'p.period_label',
          'p.amount',
          'p.currency',
          'p.due_date',
          'p.paid_at',
          trx.raw(`${DISPLAY_STATUS_SQL} AS display_status`)
        )
        .orderByRaw('p.due_date ASC NULLS LAST')
    : [];

  const isDue = (p) => ['pending', 'overdue', 'reported'].includes(p.display_status);

  /** [{ currency, total }] sin mezclar monedas. */
  const sumByCurrency = (list) =>
    Object.entries(
      list.reduce((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] || 0) + Number(p.amount) }), {})
    ).map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }));

  /** Suma en Bs; null si algún monto en USD no tiene tasa registrada (no se inventa un total parcial). */
  const sumVes = (list) =>
    list.some((p) => p.ves_amount === null)
      ? null
      : Math.round(list.reduce((n, p) => n + Number(p.ves_amount), 0) * 100) / 100;

  const summaryFor = (studentId) => {
    const mine = payments.filter((p) => p.student_id === studentId);
    const due = mine.filter(isDue);
    const paid = mine.filter((p) => p.display_status === 'paid').sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
    const next = mine.find((p) => ['pending', 'scheduled'].includes(p.display_status));
    return {
      pending_count: due.length,
      overdue_count: due.filter((p) => p.display_status === 'overdue').length,
      reported_count: due.filter((p) => p.display_status === 'reported').length,
      pending_amounts: sumByCurrency(due),
      pending_ves: sumVes(due),
      paid_count: paid.length,
      next_due: next
        ? { period_label: next.period_label, due_date: next.due_date, amount: Number(next.amount), currency: next.currency }
        : null,
      last_paid: paid[0]
        ? { period_label: paid[0].period_label, paid_at: paid[0].paid_at, amount: Number(paid[0].amount), currency: paid[0].currency }
        : null,
    };
  };

  const withPayments = students.map((s) => ({ ...s, payments: summaryFor(s.id) }));
  const allDue = payments.filter(isDue);

  return {
    guardian,
    // Alumnos inscritos cuyas mensualidades no se pudieron generar (sin tarifa,
    // etc.): mientras haya alguno, "0 pendientes" NO significa "al día".
    billing_issues: billingIssues.map((b) => ({ student_id: b.student_id, student_name: b.student_name, reasons: b.reasons })),
    students: withPayments,
    totals: {
      students: students.length,
      pending_count: allDue.length,
      overdue_count: allDue.filter((p) => p.display_status === 'overdue').length,
      pending_amounts: sumByCurrency(allDue),
      pending_ves: sumVes(allDue),
    },
    exchange: await exchange.getRateStatus(trx, tenantId),
  };
}

module.exports = { getGuardianPortal };
