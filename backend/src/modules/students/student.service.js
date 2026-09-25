const { ApiError } = require('../../utils/ApiError');

// ---------- Alumnos ----------

async function listStudents(trx, tenantId, { status } = {}) {
  const query = trx('students').where({ tenant_id: tenantId }).orderBy(['last_name', 'first_name']);
  if (status) query.andWhere({ status });
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

async function listGuardians(trx, tenantId) {
  return trx('guardians').where({ tenant_id: tenantId }).orderBy(['last_name', 'first_name']);
}

async function getGuardianById(trx, tenantId, id) {
  const guardian = await trx('guardians').where({ id, tenant_id: tenantId }).first();
  if (!guardian) throw ApiError.notFound('Representante no encontrado.');

  const students = await trx('student_guardians as sg')
    .join('students as s', 's.id', 'sg.student_id')
    .where('sg.guardian_id', id)
    .select('s.id', 's.first_name', 's.last_name', 'sg.relationship', 'sg.is_primary');

  return { ...guardian, students };
}

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
  return guardian;
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
  const [updated] = await trx('guardians').where({ id }).update(payload).returning('*');
  return updated;
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
  createGuardian,
  updateGuardian,
  linkGuardian,
  unlinkGuardian,
};
