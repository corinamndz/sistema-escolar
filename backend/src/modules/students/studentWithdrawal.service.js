const { ApiError } = require('../../utils/ApiError');
const record = require('../academics/academicRecord.service');
const tuition = require('../payments/tuition.service');
const carryovers = require('../carryovers/carryover.service');

/**
 * Retiro de un alumno (migración 088). Es lógico: nunca se borra nada, y sus
 * notas, boletas, planillas y pagos siguen consultables.
 *
 * Al retirar, en una sola transacción:
 *   - cada matrícula activa pasa a 'withdrawn' con su boleta congelada: así sale
 *     de listas, secciones, cupos, promoción y mensualidades, y el historial no
 *     cambia aunque luego se edite un plan;
 *   - se anulan las mensualidades pendientes de meses futuros (las deudas quedan);
 *   - sale de sus clubes y sus materias pendientes quedan en suspenso;
 *   - queda la constancia en student_withdrawals.
 *
 * «Retirar de la sección» (academics, DELETE /enrollments/:id) es otra cosa: el
 * alumno sigue activo en el colegio y se puede inscribir en otra sección.
 */

const WITHDRAWABLE = ['active', 'inactive'];

async function loadForUpdate(trx, tenantId, studentId) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).forUpdate().first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  return student;
}

async function withdrawStudent(trx, tenantId, userId, studentId, { withdrawnOn = null, reason = null } = {}) {
  const student = await loadForUpdate(trx, tenantId, studentId);
  if (student.status === 'withdrawn') throw ApiError.conflict('El alumno ya está retirado.');
  if (!WITHDRAWABLE.includes(student.status)) throw ApiError.conflict('Un alumno egresado no se puede retirar.');

  const { rows } = await trx.raw('SELECT current_date::text AS today');
  const today = rows[0].today;
  const date = withdrawnOn || today;
  if (date > today) throw ApiError.unprocessable('La fecha de retiro no puede ser futura.', [{ path: 'withdrawnOn', message: 'No puede ser futura.' }]);

  const enrollments = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .select('e.id', 'e.student_id', 'e.section_id', 'sec.school_period_id');

  const records = await record.computeRecords(trx, tenantId, enrollments);
  let cancelledTuition = 0;
  for (const enr of enrollments) {
    const rec = records.get(enr.id);
    await record.freezeResults(trx, tenantId, enr.id, rec);
    cancelledTuition += await tuition.cancelFutureTuition(trx, tenantId, enr.id);
    await trx('enrollments').where({ id: enr.id }).update({
      status: 'withdrawn',
      closed_at: trx.fn.now(),
      closed_by: userId,
      final_average: rec.final_average,
      failed_subjects: rec.failed_subjects,
      outcome_notes: reason,
      evaluation_rules: JSON.stringify(rec.rules),
    });
  }

  const clubs = await trx('club_memberships').where({ tenant_id: tenantId, student_id: studentId, status: 'active' }).update({ status: 'withdrawn', withdrawn_on: date });
  await carryovers.suspendForStudent(trx, tenantId, studentId);
  await trx('students').where({ id: studentId }).update({ status: 'withdrawn' });
  const [withdrawal] = await trx('student_withdrawals')
    .insert({ tenant_id: tenantId, student_id: studentId, withdrawn_on: date, reason, recorded_by: userId, enrollment_ids: enrollments.map((e) => e.id) })
    .returning('*');

  return { withdrawal, closed_enrollments: enrollments.length, cancelled_tuition: cancelledTuition, left_clubs: clubs };
}

/**
 * Reincorpora al alumno y le devuelve las matrículas que cerró el retiro, si su
 * año sigue abierto y la sección tiene cupo; las que no, se informan para
 * inscribirlo a mano. Vuelven las mensualidades que anuló el retiro desde el mes
 * en curso: los meses que pasaron mientras estuvo retirado no se le cobran. Los
 * clubes no se restauran. La constancia del retiro se conserva.
 */
async function reactivateStudent(trx, tenantId, userId, studentId) {
  const student = await loadForUpdate(trx, tenantId, studentId);
  if (student.status !== 'withdrawn') throw ApiError.conflict('El alumno no está retirado.');
  await trx('students').where({ id: studentId }).update({ status: 'active' });
  await carryovers.resumeForStudent(trx, tenantId, studentId);

  const open = await trx('student_withdrawals').where({ tenant_id: tenantId, student_id: studentId }).whereNull('reactivated_at').first();
  const enrollments = open?.enrollment_ids?.length
    ? await trx('enrollments as e')
        .join('sections as sec', 'sec.id', 'e.section_id')
        .join('grades as g', 'g.id', 'sec.grade_id')
        .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
        .whereIn('e.id', open.enrollment_ids)
        .where('e.status', 'withdrawn')
        .select('e.id', 'e.section_id', 'e.closed_at', 'sec.name as section_name', 'sec.max_students', 'g.name as grade_name', 'sp.name as period_name', 'sp.closed_at as period_closed_at')
    : [];

  const restored = [];
  const notRestored = [];
  let restoredTuition = 0;
  for (const enr of enrollments) {
    const where = { grade_name: enr.grade_name, section_name: enr.section_name, school_period_name: enr.period_name };
    if (enr.period_closed_at) {
      notRestored.push({ ...where, reason: 'El año escolar ya finalizó.' });
      continue;
    }
    await trx('sections').where({ id: enr.section_id }).forUpdate().first('id');
    const { n } = await trx('enrollments').where({ section_id: enr.section_id, status: 'active' }).count('id as n').first();
    if (Number(n) >= enr.max_students) {
      notRestored.push({ ...where, reason: 'La sección ya no tiene cupo.' });
      continue;
    }
    restoredTuition += await trx('payments')
      .where({ enrollment_id: enr.id, kind: 'tuition', status: 'cancelled' })
      .whereNull('cancel_reason')
      .andWhere('cancelled_at', '>=', enr.closed_at)
      .whereRaw("billing_month >= date_trunc('month', current_date)")
      .update({ status: 'pending', cancelled_at: null });
    await trx('enrollment_subject_results').where({ enrollment_id: enr.id }).delete();
    await trx('enrollments').where({ id: enr.id }).update({ status: 'active', closed_at: null, closed_by: null, final_average: null, failed_subjects: null, outcome_notes: null, evaluation_rules: null });
    await tuition.generateTuition(trx, tenantId, { enrollmentId: enr.id });
    restored.push(where);
  }

  if (open) await trx('student_withdrawals').where({ id: open.id }).update({ reactivated_at: trx.fn.now(), reactivated_by: userId });
  return { restored, not_restored: notRestored, restored_tuition: restoredTuition };
}

module.exports = { withdrawStudent, reactivateStudent };
