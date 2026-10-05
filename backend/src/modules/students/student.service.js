const { ApiError } = require('../../utils/ApiError');
const { applyPortalAccess, getPortalAccess, deactivatePortalUser } = require('./portalAccess.service');
const tuition = require('../payments/tuition.service');
const teacherScope = require('../access/teacherScope');

// ---------- Alumnos ----------

/**
 * Alumnos con su inscripción vigente (sección, grado, nivel, año escolar) para
 * poder agruparlos por grado y sección. Si un alumno tuviera inscripciones
 * activas en más de un año, se toma la del año activo más reciente. Los
 * campos de inscripción vienen en null si no está inscrito.
 */
async function listStudents(trx, tenantId, { status, scope = null } = {}) {
  const query = trx('students as s')
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT e.id AS enrollment_id, sec.id AS section_id, sec.name AS section_name, sec.max_students,
                g.id AS grade_id, g.name AS grade_name, g.sort_order AS grade_sort,
                g.level_code, el.sort_order AS level_sort,
                sp.id AS school_period_id, sp.name AS school_period_name
         FROM enrollments e
         JOIN sections sec ON sec.id = e.section_id
         JOIN grades g ON g.id = sec.grade_id
         JOIN education_levels el ON el.code = g.level_code
         JOIN school_periods sp ON sp.id = sec.school_period_id
         WHERE e.student_id = s.id AND e.status = 'active'
         ORDER BY sp.is_active DESC, sp.start_date DESC NULLS LAST
         LIMIT 1
       ) cur ON true`
    )
    .where('s.tenant_id', tenantId)
    .select('s.*', 'cur.*')
    .orderBy(['s.last_name', 's.first_name']);
  if (status) query.andWhere('s.status', status);
  // Docente: solo alumnos con inscripción vigente en una sección de su carga.
  teacherScope.restrictStudents(query, scope, 's.id');
  return query;
}

async function getStudentById(trx, tenantId, id) {
  const student = await trx('students').where({ id, tenant_id: tenantId }).first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');

  const guardians = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('sg.student_id', id)
    .select('g.id', 'g.first_name', 'g.last_name', 'g.phone', 'g.email', 'sg.relationship', 'sg.is_primary');

  const enrollment = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as gr', 'gr.id', 'sec.grade_id')
    .where('e.student_id', id)
    .andWhere('e.status', 'active')
    .select('e.id as enrollment_id', 'sec.id as section_id', 'sec.name as section_name', 'gr.name as grade_name')
    .first();

  return { ...student, guardians, currentEnrollment: enrollment || null };
}

async function createStudent(trx, tenantId, data) {
  const [student] = await trx('students')
    .insert({
      tenant_id: tenantId,
      first_name: data.firstName,
      last_name: data.lastName,
      birth_date: data.birthDate,
      national_id: data.nationalId,
    })
    .returning('*');
  return student;
}

async function updateStudent(trx, tenantId, id, data) {
  await getStudentById(trx, tenantId, id);
  const payload = {
    first_name: data.firstName,
    last_name: data.lastName,
    birth_date: data.birthDate,
    national_id: data.nationalId,
    status: data.status,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  const [updated] = await trx('students').where({ id }).update(payload).returning('*');
  return updated;
}

// ---------- Representantes ----------

/**
 * Representantes con un resumen de sus alumnos (cantidad y nombres), para
 * mostrarlos en la tabla sin una consulta extra por fila.
 */
async function listGuardians(trx, tenantId) {
  return trx('guardians as g')
    .where('g.tenant_id', tenantId)
    .leftJoin('users as u', 'u.id', 'g.user_id')
    .select(
      'g.*',
      // Estado del acceso al portal: 'active' | 'inactive' | null (sin usuario).
      'u.username as portal_username',
      'u.status as portal_status',
      'u.last_login_at as portal_last_login_at',
      trx.raw(`(
        SELECT count(*)::int FROM student_guardians sg WHERE sg.guardian_id = g.id
      ) AS student_count`),
      trx.raw(`COALESCE((
        SELECT json_agg(s.first_name || ' ' || s.last_name ORDER BY s.last_name, s.first_name)
        FROM student_guardians sg JOIN students s ON s.id = sg.student_id
        WHERE sg.guardian_id = g.id
      ), '[]'::json) AS student_names`)
    )
    .orderBy(['g.last_name', 'g.first_name']);
}

/**
 * Alumnos vinculados a un representante, con su grado y sección actuales.
 * "Actual" = la inscripción activa del año escolar más reciente (un alumno
 * puede tener inscripciones activas en más de un año si no se cerró el
 * anterior); si no tiene ninguna, los campos de sección vienen en null.
 */
async function listGuardianStudents(trx, guardianId) {
  const { rows } = await trx.raw(
    `SELECT s.id, s.first_name, s.last_name, s.national_id, s.status,
            sg.relationship, sg.is_primary,
            cur.section_id, cur.section_name, cur.grade_name, cur.level_code, cur.level_name, cur.school_period_name
     FROM student_guardians sg
     JOIN students s ON s.id = sg.student_id
     LEFT JOIN LATERAL (
       SELECT sec.id AS section_id, sec.name AS section_name, g.name AS grade_name,
              g.level_code, el.name AS level_name, sp.name AS school_period_name
       FROM enrollments e
       JOIN sections sec ON sec.id = e.section_id
       JOIN grades g ON g.id = sec.grade_id
       JOIN education_levels el ON el.code = g.level_code
       JOIN school_periods sp ON sp.id = sec.school_period_id
       WHERE e.student_id = s.id AND e.status = 'active'
       ORDER BY sp.is_active DESC, sp.start_date DESC NULLS LAST, e.enrolled_at DESC
       LIMIT 1
     ) cur ON true
     WHERE sg.guardian_id = ?
     ORDER BY sg.is_primary DESC, s.last_name, s.first_name`,
    [guardianId]
  );
  return rows;
}

async function getGuardianById(trx, tenantId, id) {
  const guardian = await trx('guardians').where({ id, tenant_id: tenantId }).first();
  if (!guardian) throw ApiError.notFound('Representante no encontrado.');

  const students = await listGuardianStudents(trx, id);
  const portal = await getPortalAccess(trx, tenantId, guardian.user_id);
  return { ...guardian, portal, students };
}

/**
 * Crea el representante y, si `data.portal.enabled`, su usuario del portal en
 * la misma transacción: si falla el usuario (correo repetido, sin rol), no
 * queda un representante a medias.
 */
async function createGuardian(trx, tenantId, data) {
  const [guardian] = await trx('guardians')
    .insert({
      tenant_id: tenantId,
      user_id: data.userId || null,
      first_name: data.firstName,
      last_name: data.lastName,
      national_id: data.nationalId,
      phone: data.phone,
      email: data.email,
    })
    .returning('*');

  const { access, temporaryPassword } = await applyPortalAccess(trx, tenantId, guardian, data.portal);
  return { ...guardian, user_id: access?.id ?? guardian.user_id, portal: access, temporaryPassword };
}

async function updateGuardian(trx, tenantId, id, data) {
  await getGuardianById(trx, tenantId, id);
  const payload = {
    first_name: data.firstName,
    last_name: data.lastName,
    national_id: data.nationalId,
    phone: data.phone,
    email: data.email,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  const [updated] = Object.keys(payload).length
    ? await trx('guardians').where({ id }).update(payload).returning('*')
    : [await trx('guardians').where({ id }).first()];

  // También sincroniza el nombre del usuario del portal si el representante cambió de nombre.
  const portalChanges = data.portal || (updated.user_id && (data.firstName || data.lastName) ? {} : null);
  const { access, temporaryPassword } = await applyPortalAccess(trx, tenantId, updated, portalChanges);
  return { ...updated, user_id: access?.id ?? updated.user_id, portal: access, temporaryPassword };
}

/**
 * Elimina un representante. Sus vínculos con alumnos se borran en cascada
 * (student_guardians). Si tiene pagos registrados no se permite: los pagos
 * son historial contable y la FK `payments.guardian_id` es RESTRICT.
 * Su usuario del portal no se borra (auditoría) pero queda inactivo, para
 * que no pueda seguir iniciando sesión.
 */
async function deleteGuardian(trx, tenantId, id) {
  const guardian = await trx('guardians').where({ id, tenant_id: tenantId }).first();
  if (!guardian) throw ApiError.notFound('Representante no encontrado.');

  const payments = await trx('payments').where({ tenant_id: tenantId, guardian_id: id }).count('id as n').first();
  if (Number(payments.n) > 0) {
    throw ApiError.conflict(
      `No se puede eliminar a ${guardian.first_name} ${guardian.last_name}: tiene ${payments.n} pago(s) registrado(s), ` +
        'que forman parte del historial contable del colegio.'
    );
  }

  await trx('guardians').where({ id }).delete();
  await deactivatePortalUser(trx, tenantId, guardian.user_id);
}

// ---------- Asociación alumno <-> representante ----------

async function linkGuardian(trx, tenantId, studentId, { guardianId, relationship, isPrimary }) {
  // Ambas validaciones garantizan que student y guardian pertenezcan al tenant activo
  // (si no, el where con tenant_id no encuentra nada y el service lanza 404).
  await getStudentById(trx, tenantId, studentId);
  await getGuardianById(trx, tenantId, guardianId);

  const existing = await trx('student_guardians')
    .where({ student_id: studentId, guardian_id: guardianId })
    .first();
  if (existing) throw ApiError.conflict('Ese representante ya está asociado a este alumno.');

  if (isPrimary) {
    await trx('student_guardians').where({ student_id: studentId }).update({ is_primary: false });
  }

  await trx('student_guardians').insert({
    student_id: studentId,
    guardian_id: guardianId,
    relationship,
    is_primary: Boolean(isPrimary),
  });

  // Si el alumno ya estaba inscrito sin representante, sus mensualidades no se
  // habían podido generar (el pago requiere un responsable): se completan ahora.
  await tuition.generateTuition(trx, tenantId, { studentId });

  return getStudentById(trx, tenantId, studentId);
}

async function unlinkGuardian(trx, tenantId, studentId, guardianId) {
  await getStudentById(trx, tenantId, studentId);
  await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).delete();
}

module.exports = {
  listStudents,
  getStudentById,
  createStudent,
  updateStudent,
  listGuardians,
  getGuardianById,
  listGuardianStudents,
  createGuardian,
  updateGuardian,
  deleteGuardian,
  linkGuardian,
  unlinkGuardian,
};
