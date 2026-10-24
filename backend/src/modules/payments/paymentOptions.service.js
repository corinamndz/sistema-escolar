const { ApiError } = require('../../utils/ApiError');

/**
 * Datos de otros módulos que necesitan los formularios de Pagos, con lo
 * mínimo y bajo el permiso de Pagos: así un rol solo de Finanzas trabaja sin
 * recibir permisos de Alumnos o Académico (que le abrirían esos módulos).
 */

/** Años escolares para filtros, tarifas y generación de mensualidades. */
function listSchoolPeriods(trx, tenantId) {
  return trx('school_periods')
    .where({ tenant_id: tenantId })
    .select('id', 'name', 'start_date', 'end_date', 'is_active', 'closed_at')
    .orderBy('start_date', 'desc');
}

/** Alumnos activos para "Otro cobro": solo nombre. */
function listStudents(trx, tenantId) {
  return trx('students').where({ tenant_id: tenantId, status: 'active' }).select('id', 'first_name', 'last_name').orderBy(['last_name', 'first_name']);
}

/** Representantes de un alumno (a quién se le carga el cobro). */
async function listStudentGuardians(trx, tenantId, studentId) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('id');
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  return trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where({ 'sg.student_id': studentId, 'g.tenant_id': tenantId })
    .select('g.id', 'g.first_name', 'g.last_name', 'sg.is_primary')
    .orderBy([{ column: 'sg.is_primary', order: 'desc' }, 'g.last_name']);
}

module.exports = { listSchoolPeriods, listStudents, listStudentGuardians };
