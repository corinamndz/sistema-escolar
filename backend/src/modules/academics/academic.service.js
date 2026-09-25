const { ApiError } = require('../../utils/ApiError');

// ---------- Periodos escolares (años) ----------

async function listSchoolPeriods(trx, tenantId) {
  return trx('school_periods').where({ tenant_id: tenantId }).orderBy('start_date', 'desc');
}

async function createSchoolPeriod(trx, tenantId, { name, startDate, endDate }) {
  const [period] = await trx('school_periods')
    .insert({ tenant_id: tenantId, name, start_date: startDate, end_date: endDate })
    .returning('*');
  return period;
}

// ---------- Aulas físicas ----------

async function listClassrooms(trx, tenantId) {
  return trx('classrooms').where({ tenant_id: tenantId }).orderBy('name');
}

async function createClassroom(trx, tenantId, { name, capacity }) {
  const [classroom] = await trx('classrooms').insert({ tenant_id: tenantId, name, capacity }).returning('*');
  return classroom;
}

// ---------- Grados ----------

async function listGrades(trx, tenantId) {
  return trx('grades').where({ tenant_id: tenantId }).orderBy('sort_order');
}

async function createGrade(trx, tenantId, { name, sortOrder }) {
  const [grade] = await trx('grades')
    .insert({ tenant_id: tenantId, name, sort_order: sortOrder ?? 0 })
    .returning('*');
  return grade;
}

// ---------- Secciones ----------

async function listSections(trx, tenantId, { schoolPeriodId, gradeId } = {}) {
  const query = trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where('sec.tenant_id', tenantId)
    .select(
      'sec.*',
      'g.name as grade_name'
    )
    .orderBy(['g.sort_order', 'sec.name']);
  if (schoolPeriodId) query.andWhere('sec.school_period_id', schoolPeriodId);
  if (gradeId) query.andWhere('sec.grade_id', gradeId);
  return query;
}

async function getSectionById(trx, tenantId, id) {
  const section = await trx('sections').where({ id, tenant_id: tenantId }).first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');
  return section;
}

async function createSection(trx, tenantId, data) {
  if (data.assistantTeacherId && data.assistantTeacherId === data.leadTeacherId) {
    throw ApiError.badRequest('El docente auxiliar no puede ser el mismo que el docente titular.');
  }

  const [section] = await trx('sections')
    .insert({
      tenant_id: tenantId,
      grade_id: data.gradeId,
      school_period_id: data.schoolPeriodId,
      classroom_id: data.classroomId || null,
      name: data.name,
      max_students: data.maxStudents ?? 30,
      lead_teacher_id: data.leadTeacherId || null,
      assistant_teacher_id: data.assistantTeacherId || null,
    })
    .returning('*');
  return section;
}

async function updateSection(trx, tenantId, id, data) {
  await getSectionById(trx, tenantId, id);

  if (data.assistantTeacherId && data.leadTeacherId && data.assistantTeacherId === data.leadTeacherId) {
    throw ApiError.badRequest('El docente auxiliar no puede ser el mismo que el docente titular.');
  }

  const payload = {
    classroom_id: data.classroomId,
    name: data.name,
    max_students: data.maxStudents,
    lead_teacher_id: data.leadTeacherId,
    assistant_teacher_id: data.assistantTeacherId,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const [updated] = await trx('sections').where({ id }).update(payload).returning('*');
  return updated;
}

// ---------- Inscripciones ----------

/**
 * Inscribe un alumno en una sección, respetando `max_students`. Se bloquea
 * la fila de la sección (`forUpdate`) para que dos inscripciones concurrentes
 * no rebasen el cupo (misma técnica que la validación del 100% en planes de
 * evaluación).
 */
async function enrollStudent(trx, tenantId, { studentId, sectionId }) {
  const [section] = await trx('sections').where({ id: sectionId, tenant_id: tenantId }).forUpdate();
  if (!section) throw ApiError.notFound('Sección no encontrada.');

  const activeCount = await trx('enrollments')
    .where({ tenant_id: tenantId, section_id: sectionId, status: 'active' })
    .count('id as count')
    .first();

  if (Number(activeCount.count) >= section.max_students) {
    throw ApiError.unprocessable(
      `La sección "${section.name}" ya alcanzó su cupo máximo (${section.max_students} alumnos).`
    );
  }

  const existing = await trx('enrollments')
    .where({ student_id: studentId, section_id: sectionId })
    .first();
  if (existing && existing.status === 'active') {
    throw ApiError.conflict('El alumno ya está inscrito en esta sección.');
  }

  const [enrollment] = await trx('enrollments')
    .insert({ tenant_id: tenantId, student_id: studentId, section_id: sectionId })
    .returning('*');
  return enrollment;
}

async function withdrawEnrollment(trx, tenantId, enrollmentId) {
  const enrollment = await trx('enrollments').where({ id: enrollmentId, tenant_id: tenantId }).first();
  if (!enrollment) throw ApiError.notFound('Inscripción no encontrada.');
  await trx('enrollments').where({ id: enrollmentId }).update({ status: 'withdrawn' });
}

async function listSectionRoster(trx, tenantId, sectionId) {
  await getSectionById(trx, tenantId, sectionId);
  return trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .where('e.tenant_id', tenantId)
    .andWhere('e.section_id', sectionId)
    .andWhere('e.status', 'active')
    .select('e.id as enrollment_id', 's.id as student_id', 's.first_name', 's.last_name')
    .orderBy(['s.last_name', 's.first_name']);
}

module.exports = {
  listSchoolPeriods,
  createSchoolPeriod,
  listClassrooms,
  createClassroom,
  listGrades,
  createGrade,
  listSections,
  getSectionById,
  createSection,
  updateSection,
  enrollStudent,
  withdrawEnrollment,
  listSectionRoster,
};
