const { ApiError } = require('../../utils/ApiError');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');
const { logAudit } = require('../../services/audit/audit.service');
const tuition = require('./tuition.service');

/**
 * Tarifas especiales por alumno (migración 071).
 *
 * Catálogo (fee_plans), configurado en Finanzas → Tarifas de mensualidad:
 *   - 'percentage'  descuento sobre la tarifa del nivel: Beca 50 % (50), Beca total (100)…
 *   - 'fixed'       monto mensual fijo en USD: Convenio empresa ($80)…
 *
 * Cada alumno tiene, como máximo, una (students.fee_plan_id). NULL = la tarifa
 * general de su nivel: es el valor por defecto al crear o inscribir un alumno,
 * y sigue la tarifa del nivel de cada año escolar sin intervención.
 *
 * Al generar las mensualidades (tuition.service) se consulta primero la tarifa
 * especial del alumno y, si no tiene, la del nivel. Asignar o cambiar una
 * tarifa especial recalcula los meses que aún se pueden cambiar (ver
 * tuition.applyStudentFeePlan).
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Monto mensual con la tarifa especial `plan` (o null) sobre la tarifa base del nivel. Igual que effectiveAmountSql. */
function effectiveAmount(base, plan) {
  if (!plan) return base === null || base === undefined ? null : Number(base);
  if (plan.kind === 'fixed') return Number(plan.amount);
  if (base === null || base === undefined) return null;
  return round2((Number(base) * (100 - Number(plan.percentage))) / 100);
}

/** Texto corto de una tarifa: "50 % de descuento", "Exonerado (100 %)", "$80,00 fijos". */
function describePlan(plan) {
  if (!plan) return 'Tarifa general del nivel';
  if (plan.kind === 'fixed') return `$${Number(plan.amount).toFixed(2).replace('.', ',')} fijos al mes`;
  const pct = Number(plan.percentage);
  return pct >= 100 ? 'Exonerado (100 %)' : `${String(pct).replace('.', ',')} % de descuento`;
}

// ---------- Catálogo ----------

async function listFeePlans(trx, tenantId) {
  return trx('fee_plans as fp')
    .where('fp.tenant_id', tenantId)
    .select('fp.*', trx.raw('(SELECT count(*)::int FROM students s WHERE s.fee_plan_id = fp.id) AS student_count'))
    .orderByRaw("fp.kind, fp.percentage DESC NULLS LAST, fp.amount, lower(fp.name)");
}

async function findPlan(trx, tenantId, id) {
  const plan = await trx('fee_plans').where({ id, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Tarifa especial no encontrada.');
  return plan;
}

const toRow = (data) => ({
  name: data.name.trim(),
  kind: data.kind,
  percentage: data.kind === 'percentage' ? data.percentage : null,
  amount: data.kind === 'fixed' ? data.amount : null,
  currency: 'USD',
  description: data.description?.trim() || null,
});

/** El nombre es único por colegio (sin distinguir mayúsculas): 409 legible en vez del error de la base. */
async function assertUniqueName(trx, tenantId, name, exceptId = null) {
  const query = trx('fee_plans').where({ tenant_id: tenantId }).whereRaw('lower(name) = lower(?)', [name.trim()]);
  if (exceptId) query.whereNot({ id: exceptId });
  if (await query.first()) {
    throw ApiError.conflict(`Ya existe una tarifa especial llamada «${name.trim()}».`, [{ path: 'name', message: 'Nombre repetido.' }]);
  }
}

async function createFeePlan(trx, tenantId, data) {
  await assertUniqueName(trx, tenantId, data.name);
  const [plan] = await trx('fee_plans').insert({ tenant_id: tenantId, ...toRow(data) }).returning('*');
  return { ...plan, student_count: 0 };
}

/**
 * Cambiar el valor de una tarifa en uso (ej. Beca 50 % → 40 %) recalcula los
 * meses pendientes de todos sus alumnos, con la misma regla que una asignación.
 */
async function updateFeePlan(trx, tenantId, id, data) {
  const before = await findPlan(trx, tenantId, id);
  await assertUniqueName(trx, tenantId, data.name, id);
  const [plan] = await trx('fee_plans').where({ id }).update({ ...toRow(data), updated_at: trx.fn.now() }).returning('*');

  const valueChanged =
    before.kind !== plan.kind || Number(before.percentage) !== Number(plan.percentage) || Number(before.amount) !== Number(plan.amount);
  const studentIds = await trx('students').where({ tenant_id: tenantId, fee_plan_id: id }).pluck('id');
  const totals = { students: studentIds.length, updated: 0, cancelled: 0, reactivated: 0 };
  if (valueChanged) {
    for (const studentId of studentIds) {
      const r = await tuition.applyStudentFeePlan(trx, tenantId, studentId);
      totals.updated += r.updated;
      totals.cancelled += r.cancelled;
      totals.reactivated += r.reactivated;
    }
  }
  return { plan: { ...plan, student_count: studentIds.length }, recalculated: valueChanged ? totals : null };
}

async function deleteFeePlan(trx, tenantId, id) {
  const plan = await findPlan(trx, tenantId, id);
  const { n } = await trx('students').where({ tenant_id: tenantId, fee_plan_id: id }).count('id as n').first();
  if (Number(n) > 0) {
    throw ApiError.conflict(
      `La tarifa «${plan.name}» está asignada a ${n} alumno(s). Cámbiales la tarifa desde su ficha antes de eliminarla.`
    );
  }
  await trx('fee_plans').where({ id }).delete();
}

// ---------- Tarifa del alumno ----------

/**
 * Mensualidad vigente del alumno: su inscripción del año en curso, la tarifa
 * base (de su nivel o la general), la tarifa especial asignada y el monto final.
 */
async function getStudentFee(trx, tenantId, studentId) {
  const student = await trx('students as s')
    .leftJoin('fee_plans as fp', 'fp.id', 's.fee_plan_id')
    .where({ 's.id': studentId, 's.tenant_id': tenantId })
    .first(
      's.id', 's.first_name', 's.last_name', 's.fee_plan_note', 's.fee_plan_assigned_at',
      's.payment_grace_days', 's.payment_agreement_note', 's.payment_agreement_at',
      'fp.id as plan_id', 'fp.name as plan_name', 'fp.kind as plan_kind', 'fp.percentage as plan_percentage',
      'fp.amount as plan_amount', 'fp.currency as plan_currency', 'fp.description as plan_description'
    );
  if (!student) throw ApiError.notFound('Alumno no encontrado.');

  const enrollment = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.student_id': studentId, 'e.status': 'active' })
    .orderByRaw(currentPeriodOrder('sp'))
    .first('g.name as grade_name', 'sec.name as section_name', 'g.level_code', 'el.name as level_name', 'sp.id as school_period_id', 'sp.name as school_period_name');

  let base = null;
  if (enrollment) {
    const fee = await trx('tuition_fees')
      .where({ tenant_id: tenantId, school_period_id: enrollment.school_period_id })
      .andWhere((q) => q.where('level_code', enrollment.level_code).orWhereNull('level_code'))
      .orderByRaw('level_code NULLS LAST')
      .first('amount', 'currency', 'due_day', 'level_code');
    if (fee) base = { amount: Number(fee.amount), currency: fee.currency, due_day: fee.due_day, source: fee.level_code ? 'level' : 'general' };
  }

  const plan = student.plan_id
    ? {
        id: student.plan_id,
        name: student.plan_name,
        kind: student.plan_kind,
        percentage: student.plan_percentage === null ? null : Number(student.plan_percentage),
        amount: student.plan_amount === null ? null : Number(student.plan_amount),
        currency: student.plan_currency,
        description: student.plan_description,
      }
    : null;

  // Mensualidades pendientes que aún siguen a la tarifa (desde el mes en curso, sin reportar).
  const upcoming = await trx('payments')
    .where({ tenant_id: tenantId, student_id: studentId, kind: 'tuition', status: 'pending' })
    .whereNull('reported_at')
    .whereNull('batch_id')
    .whereRaw("COALESCE(issue_date, billing_month) >= date_trunc('month', current_date)")
    .count('id as n')
    .first();

  return {
    student_id: student.id,
    plan,
    plan_label: describePlan(plan),
    note: student.fee_plan_note,
    assigned_at: student.fee_plan_assigned_at,
    enrollment: enrollment || null,
    base,
    effective_amount: base || plan?.kind === 'fixed' ? effectiveAmount(base?.amount ?? null, plan) : null,
    currency: 'USD',
    upcoming_months: Number(upcoming.n),
    // Acuerdo de pago (077): días de gracia sobre la fecha límite estándar del nivel (base.due_day).
    agreement: student.payment_grace_days
      ? { grace_days: student.payment_grace_days, note: student.payment_agreement_note, assigned_at: student.payment_agreement_at }
      : null,
  };
}

/**
 * Asigna (o quita, con feePlanId null → tarifa general del nivel) la tarifa
 * especial del alumno y la aplica a sus mensualidades pendientes.
 */
async function assignStudentFeePlan(trx, tenantId, studentId, { feePlanId = null, note = null }) {
  const before = await getStudentFee(trx, tenantId, studentId);
  const studentName = await trx('students').where({ id: studentId }).first('first_name', 'last_name');
  const plan = feePlanId ? await findPlan(trx, tenantId, feePlanId) : null;

  await trx('students')
    .where({ id: studentId, tenant_id: tenantId })
    .update({
      fee_plan_id: plan?.id ?? null,
      fee_plan_note: plan ? note?.trim() || null : null,
      fee_plan_assigned_at: plan ? trx.fn.now() : null,
    });

  const applied = await tuition.applyStudentFeePlan(trx, tenantId, studentId);
  const fee = await getStudentFee(trx, tenantId, studentId);

  await logAudit(trx, {
    tenantId,
    module: 'payments',
    action: 'student_fee_plan.assign',
    entity: 'students',
    entityId: studentId,
    summary: `Tarifa de ${studentName.first_name} ${studentName.last_name}: «${before.plan?.name || 'Tarifa general del nivel'}» → «${plan?.name || 'Tarifa general del nivel'}»`,
    diff: { student_id: studentId, before: before.plan?.id || null, after: plan?.id || null, note: fee.note, applied },
  });

  return { fee, applied };
}

/**
 * Asigna (graceDays 1–60) o quita (null) el acuerdo de pago del alumno y lo
 * aplica a sus mensualidades pendientes desde el mes en curso.
 */
async function setPaymentAgreement(trx, tenantId, studentId, { graceDays = null, note = null }) {
  const before = await getStudentFee(trx, tenantId, studentId);
  const st = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('first_name', 'last_name');
  await trx('students')
    .where({ id: studentId, tenant_id: tenantId })
    .update({
      payment_grace_days: graceDays,
      payment_agreement_note: graceDays ? note?.trim() || null : null,
      payment_agreement_at: graceDays ? trx.fn.now() : null,
    });
  const updated = await tuition.applyStudentGrace(trx, tenantId, studentId);
  const fee = await getStudentFee(trx, tenantId, studentId);
  const label = (a) => (a ? `+${a.grace_days} días` : 'plazo estándar');
  await logAudit(trx, {
    tenantId,
    module: 'payments',
    action: 'student_payment_agreement.set',
    entity: 'students',
    entityId: studentId,
    summary: `Acuerdo de pago de ${st.first_name} ${st.last_name}: ${label(before.agreement)} → ${label(fee.agreement)}`,
    diff: { before: before.agreement, after: fee.agreement, updated },
  });
  return { fee, updated };
}

module.exports = {
  setPaymentAgreement,
  effectiveAmount,
  describePlan,
  listFeePlans,
  createFeePlan,
  updateFeePlan,
  deleteFeePlan,
  getStudentFee,
  assignStudentFeePlan,
};
