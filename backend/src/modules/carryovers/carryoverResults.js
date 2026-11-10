const { yearAverage } = require('../grading/gradeAverages');

/**
 * La recuperación de las materias pendientes, vista desde la boleta del año en
 * que se reprobaron. La boleta congelada (enrollment_subject_results) NO se
 * modifica: la nota original se conserva y se ANOTA la recuperación. Se calcula
 * al leer, así una corrección o una anulación posterior se reflejan solas.
 *
 *   recovery  { status, grade, passing_grade, moment_name, resolved_at }
 *     status passed       aprobada en recuperación: cuenta como aprobada y su
 *                         nota entra en el promedio del año en lugar de la original
 *     status pending / in_progress / failed / suspended   solo se informa
 * Las anuladas no se anotan: es como si no hubiera habido materia pendiente.
 */

const key = (enrollmentId, subjectKey) => `${enrollmentId}|${subjectKey}`;
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Map "<matrícula>|<materia>" → recovery, para esas matrículas de origen. */
async function recoveriesFor(trx, tenantId, enrollmentIds) {
  const map = new Map();
  if (!enrollmentIds.length) return map;
  const rows = await trx('subject_carryovers as c')
    .leftJoin('carryover_moments as m', function passedMoment() {
      this.on('m.carryover_id', 'c.id').andOnVal('m.status', 'passed');
    })
    .where('c.tenant_id', tenantId)
    .whereIn('c.source_enrollment_id', enrollmentIds)
    .whereNot('c.status', 'cancelled')
    .select('c.source_enrollment_id', 'c.subject_key', 'c.status', 'c.final_grade', 'c.passing_grade', 'c.resolved_at', 'm.name as moment_name', 'm.passing_grade as moment_passing_grade');
  rows.forEach((r) =>
    map.set(key(r.source_enrollment_id, r.subject_key), {
      status: r.status,
      grade: r.status === 'passed' || r.status === 'failed' ? num(r.final_grade) : null,
      passing_grade: num(r.moment_passing_grade ?? r.passing_grade),
      moment_name: r.moment_name || null,
      resolved_at: r.resolved_at || null,
    })
  );
  return map;
}

/**
 * Un año cerrado con sus recuperaciones: cada materia con su `recovery` (si la
 * tuvo) y, si alguna se aprobó, el promedio recalculado con la nota de
 * recuperación y las reprobadas descontadas. Lo original queda en
 * `original_final_average` y `original_failed_subjects`.
 */
function withRecoveries({ enrollmentId, subjects, finalAverage, failedSubjects }, recoveries) {
  const list = subjects.map((s) => {
    const recovery = recoveries.get(key(enrollmentId, s.subject_key));
    return recovery ? { ...s, recovery } : s;
  });
  const recovered = list.filter((s) => s.passed === false && s.recovery?.status === 'passed');
  if (!recovered.length) return { subjects: list, final_average: finalAverage, failed_subjects: failedSubjects, recalculated: false };
  return {
    subjects: list,
    final_average: yearAverage(list.map((s) => ({ final: s.recovery?.status === 'passed' ? s.recovery.grade : s.final_grade })), {}),
    failed_subjects: Math.max(0, (failedSubjects ?? list.filter((s) => s.passed === false).length) - recovered.length),
    recalculated: true,
    original_final_average: finalAverage,
    original_failed_subjects: failedSubjects,
  };
}

/**
 * Para la boleta oficial (Resumen de calificaciones) de un año: Map alumno →
 * [{ subject_key, subject_name, recovery }] de las materias que arrastra de ESE año.
 * La boleta oficial reconoce las materias por su id o, en texto libre, por su
 * nombre: se devuelven los dos para emparejar.
 */
async function recoveriesForPeriod(trx, tenantId, periodId, studentIds) {
  const map = new Map();
  if (!studentIds.length) return map;
  const rows = await trx('subject_carryovers as c')
    .join('enrollments as se', 'se.id', 'c.source_enrollment_id')
    .join('sections as sec', 'sec.id', 'se.section_id')
    .where({ 'c.tenant_id': tenantId, 'sec.school_period_id': periodId })
    .whereIn('c.student_id', studentIds)
    .whereNot('c.status', 'cancelled')
    .select('c.student_id', 'c.source_enrollment_id', 'c.subject_key', 'c.subject_name');
  const recoveries = await recoveriesFor(trx, tenantId, [...new Set(rows.map((r) => r.source_enrollment_id))]);
  rows.forEach((r) => {
    const list = map.get(r.student_id) || [];
    list.push({ subject_key: r.subject_key, subject_name: r.subject_name, recovery: recoveries.get(key(r.source_enrollment_id, r.subject_key)) });
    map.set(r.student_id, list);
  });
  return map;
}

/** La recuperación de una materia de la boleta oficial, por su clave o su nombre. */
const norm = (v) => String(v || '').trim().toLowerCase();
function recoveryOf(list, subject) {
  return (list || []).find((x) => x.subject_key === subject.key || norm(x.subject_name) === norm(subject.name))?.recovery || null;
}

module.exports = { recoveriesFor, withRecoveries, recoveriesForPeriod, recoveryOf };
