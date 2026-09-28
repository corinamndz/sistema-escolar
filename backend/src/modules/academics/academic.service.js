const { ApiError } = require('../../utils/ApiError');
const tuition = require('../payments/tuition.service');

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

/** Grados con su nivel educativo y conteos útiles para las tablas de gestión. */
async function listGrades(trx, tenantId, { levelCode } = {}) {
  const query = trx('grades as g')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where('g.tenant_id', tenantId)
    .select(
      'g.*',
      'el.name as level_name',
      'el.assignment_mode',
      'el.has_curriculum',
      trx.raw('(SELECT count(*)::int FROM grade_subjects gs WHERE gs.grade_id = g.id) AS subject_count'),
      trx.raw('(SELECT count(*)::int FROM sections s WHERE s.grade_id = g.id) AS section_count')
    )
    .orderBy(['el.sort_order', 'g.sort_order', 'g.name']);
  if (levelCode) query.andWhere('g.level_code', levelCode);
  return query;
}

async function getGradeById(trx, tenantId, id) {
  const grade = await trx('grades as g')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'g.id': id, 'g.tenant_id': tenantId })
    .select('g.*', 'el.name as level_name', 'el.assignment_mode', 'el.allows_assistant', 'el.has_curriculum')
    .first();
  if (!grade) throw ApiError.notFound('Grado no encontrado.');
  return grade;
}

async function assertLevelExists(trx, levelCode) {
  const level = await trx('education_levels').where({ code: levelCode }).first();
  if (!level) throw ApiError.badRequest('Nivel educativo inválido.', [{ path: 'levelCode', message: 'Nivel inválido.' }]);
  return level;
}

async function createGrade(trx, tenantId, { name, sortOrder, levelCode }) {
  await assertLevelExists(trx, levelCode);
  const [grade] = await trx('grades')
    .insert({ tenant_id: tenantId, name, sort_order: sortOrder ?? 0, level_code: levelCode })
    .returning('id');
  return getGradeById(trx, tenantId, grade.id);
}

/**
 * Actualiza un grado. Si cambia de nivel y eso deja asignaciones
 * incompatibles (ej. pasar a Primaria un grado con materias), el trigger
 * `trg_grades_level_change` lo rechaza con un mensaje explicativo que el
 * error handler global devuelve como 422.
 */
async function updateGrade(trx, tenantId, id, { name, sortOrder, levelCode }) {
  await getGradeById(trx, tenantId, id);
  if (levelCode) await assertLevelExists(trx, levelCode);

  const payload = { name, sort_order: sortOrder, level_code: levelCode };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  if (Object.keys(payload).length) await trx('grades').where({ id }).update(payload);
  return getGradeById(trx, tenantId, id);
}

// ---------- Secciones ----------

/** Columnas comunes de sección + grado + nivel + año escolar + aula. */
function sectionQuery(trx) {
  return trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .leftJoin('classrooms as c', 'c.id', 'sec.classroom_id')
    .select(
      'sec.*',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      'el.assignment_mode',
      'el.allows_assistant',
      'el.has_curriculum',
      'sp.name as school_period_name',
      'c.name as classroom_name'
    );
}

/**
 * Secciones con un resumen de la asignación docente según el nivel:
 *  - homeroom (inicial/primaria): `teachers = { lead, assistant }`
 *  - subjects (secundaria): `subjectCoverage = { total, assigned }`
 *  - homeroom con plan de estudios (primaria): además
 *    `curriculum = { total, specialists }` (materias del grado y cuántas tienen
 *    docente especialista; el resto las dicta el titular)
 */
async function listSections(trx, tenantId, { schoolPeriodId, gradeId, levelCode } = {}) {
  const query = sectionQuery(trx)
    .select(
      trx.raw(
        "(SELECT count(*)::int FROM enrollments e WHERE e.section_id = sec.id AND e.status = 'active') AS enrolled_count"
      ),
      trx.raw('(SELECT count(*)::int FROM grade_subjects gs WHERE gs.grade_id = sec.grade_id) AS subject_total'),
      trx.raw('(SELECT count(*)::int FROM teacher_subject_sections tss WHERE tss.section_id = sec.id) AS subject_assigned')
    )
    .where('sec.tenant_id', tenantId)
    .orderBy(['el.sort_order', 'g.sort_order', 'g.name', 'sec.name']);
  if (schoolPeriodId) query.andWhere('sec.school_period_id', schoolPeriodId);
  if (gradeId) query.andWhere('sec.grade_id', gradeId);
  if (levelCode) query.andWhere('g.level_code', levelCode);
  const sections = await query;

  const homeroom = sections.length
    ? await trx('teacher_sections as ts')
        .join('staff as st', 'st.id', 'ts.staff_id')
        .whereIn('ts.section_id', sections.map((s) => s.id))
        .select('ts.section_id', 'ts.role', 'st.id as staff_id', 'st.first_name', 'st.last_name')
    : [];

  return sections.map(({ subject_total: total, subject_assigned: assigned, ...s }) => {
    const find = (role) => {
      const row = homeroom.find((h) => h.section_id === s.id && h.role === role);
      return row ? { id: row.staff_id, name: `${row.first_name} ${row.last_name}` } : null;
    };
    return {
      ...s,
      teachers: s.assignment_mode === 'homeroom' ? { lead: find('lead'), assistant: find('assistant') } : null,
      subjectCoverage: s.assignment_mode === 'subjects' ? { total, assigned } : null,
      curriculum: s.assignment_mode === 'homeroom' && s.has_curriculum ? { total, specialists: assigned } : null,
    };
  });
}

async function getSectionById(trx, tenantId, id) {
  const section = await sectionQuery(trx).where({ 'sec.id': id, 'sec.tenant_id': tenantId }).first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');
  return section;
}

/** La asignación docente se gestiona aparte (assignment.service.js), según el nivel del grado. */
async function createSection(trx, tenantId, data) {
  await getGradeById(trx, tenantId, data.gradeId);
  const [section] = await trx('sections')
    .insert({
      tenant_id: tenantId,
      grade_id: data.gradeId,
      school_period_id: data.schoolPeriodId,
      classroom_id: data.classroomId || null,
      name: data.name,
      max_students: data.maxStudents ?? 30,
    })
    .returning('id');
  return getSectionById(trx, tenantId, section.id);
}

async function updateSection(trx, tenantId, id, data) {
  await getSectionById(trx, tenantId, id);

  const payload = {
    classroom_id: data.classroomId,
    name: data.name,
    max_students: data.maxStudents,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  if (Object.keys(payload).length) await trx('sections').where({ id }).update(payload);
  return getSectionById(trx, tenantId, id);
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

  // Mensualidades de todo el año escolar, en la misma transacción. Si falta la
  // tarifa o el representante no se bloquea la inscripción: se informa en
  // `tuition.skipped` y se completa luego (al vincular representante o con
  // "Generar mensualidades").
  const tuitionResult = await tuition.generateTuition(trx, tenantId, { enrollmentId: enrollment.id });
  return { ...enrollment, tuition: tuitionResult };
}

async function withdrawEnrollment(trx, tenantId, enrollmentId) {
  const enrollment = await trx('enrollments').where({ id: enrollmentId, tenant_id: tenantId }).first();
  if (!enrollment) throw ApiError.notFound('Inscripción no encontrada.');
  await trx('enrollments').where({ id: enrollmentId }).update({ status: 'withdrawn' });
  // Las mensualidades pendientes de meses futuros dejan de cobrarse.
  await tuition.cancelFutureTuition(trx, tenantId, enrollmentId);
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
  getGradeById,
  createGrade,
  updateGrade,
  listSections,
  getSectionById,
  createSection,
  updateSection,
  enrollStudent,
  withdrawEnrollment,
  listSectionRoster,
};
