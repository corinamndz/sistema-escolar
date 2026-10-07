const { ApiError } = require('../../utils/ApiError');
const teacherScope = require('../access/teacherScope');

/**
 * Convivencia: sanciones disciplinarias de los alumnos.
 *
 * Gravedad: leve (amarillo), media (naranja), grave (rojo).
 * Cada sanción queda en un año escolar y, si se puede determinar, en un lapso
 * (el indicado, o el que contiene la fecha de la falta) y con la sección en que
 * el alumno cursaba. Se audita quién la registró y quién la editó por última vez.
 */

/** Niveles de gravedad, de menor a mayor (migración 022). */
const SEVERITIES = { leve: 'Leve', media: 'Media', grave: 'Grave' };
const SEVERITY_KEYS = Object.keys(SEVERITIES);

const today = () => new Date().toISOString().slice(0, 10);

/** Sanciones con alumno, año, lapso, sección y usuario que la registró. */
function baseQuery(trx, tenantId) {
  return trx('student_sanctions as ss')
    .join('students as s', 's.id', 'ss.student_id')
    .join('school_periods as sp', 'sp.id', 'ss.school_period_id')
    .leftJoin('terms as t', 't.id', 'ss.term_id')
    .leftJoin('sections as sec', 'sec.id', 'ss.section_id')
    .leftJoin('grades as g', 'g.id', 'sec.grade_id')
    .leftJoin('users as ru', 'ru.id', 'ss.registered_by')
    .leftJoin('users as uu', 'uu.id', 'ss.updated_by')
    .where('ss.tenant_id', tenantId)
    .select(
      'ss.*',
      's.first_name',
      's.last_name',
      's.national_id',
      'sp.name as school_period_name',
      't.name as term_name',
      't.term_number',
      'sec.name as section_name',
      'g.name as grade_name',
      trx.raw('COALESCE(ru.full_name, ru.username) AS registered_by_name'),
      trx.raw('COALESCE(uu.full_name, uu.username) AS updated_by_name')
    )
    .orderBy([{ column: 'ss.occurred_on', order: 'desc' }, { column: 'ss.created_at', order: 'desc' }]);
}

const format = (r) => ({ ...r, occurred_on: r.occurred_on instanceof Date ? r.occurred_on.toISOString().slice(0, 10) : String(r.occurred_on).slice(0, 10), severity_label: SEVERITIES[r.severity] });

const totalsOf = (items) => ({
  total: items.length,
  ...Object.fromEntries(SEVERITY_KEYS.map((k) => [k, items.filter((i) => i.severity === k).length])),
});

/** Listado general (módulo Convivencia). `scope`: docente → solo alumnos de su carga. */
async function listSanctions(trx, tenantId, { schoolPeriodId, severity, studentId, q, scope = null } = {}) {
  const query = baseQuery(trx, tenantId);
  if (schoolPeriodId) query.andWhere('ss.school_period_id', schoolPeriodId);
  if (severity) query.andWhere('ss.severity', severity);
  if (studentId) query.andWhere('ss.student_id', studentId);
  if (q) {
    const like = `%${q.trim()}%`;
    query.andWhere((w) =>
      w
        .whereRaw("(s.first_name || ' ' || s.last_name) ILIKE ?", [like])
        .orWhere('s.national_id', 'ilike', like)
        .orWhere('ss.fault_type', 'ilike', like)
        .orWhere('ss.description', 'ilike', like)
    );
  }
  teacherScope.restrictStudents(query, scope, 'ss.student_id', { activeOnly: false });
  const items = (await query).map(format);
  return { items, totals: totalsOf(items) };
}

/** Historial disciplinario de un alumno (su ficha). */
async function getStudentSanctions(trx, tenantId, studentId) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).select('id', 'first_name', 'last_name').first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  const items = (await baseQuery(trx, tenantId).andWhere('ss.student_id', studentId)).map(format);
  return { student, items, totals: totalsOf(items) };
}

async function loadSanction(trx, tenantId, id) {
  const row = await trx('student_sanctions').where({ id, tenant_id: tenantId }).first();
  if (!row) throw ApiError.notFound('Sanción no encontrada.');
  return row;
}

/**
 * Año, lapso y sección de una sanción:
 *   - año: el indicado o el de la inscripción vigente del alumno;
 *   - lapso: el indicado (número 1–3) o el que contiene la fecha de la falta;
 *   - sección: la del alumno en ese año.
 */
async function resolveContext(trx, tenantId, studentId, { schoolPeriodId, termNumber, occurredOn }) {
  let periodId = schoolPeriodId;
  if (!periodId) {
    const current = await trx('enrollments as e')
      .join('sections as sec', 'sec.id', 'e.section_id')
      .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
      .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
      .orderByRaw('sp.is_active DESC, sp.start_date DESC NULLS LAST')
      .select('sp.id')
      .first();
    if (!current) {
      throw ApiError.badRequest('El alumno no tiene una inscripción vigente: indica el año escolar de la sanción.', [{ path: 'schoolPeriodId', message: 'Requerido.' }]);
    }
    periodId = current.id;
  }
  const period = await trx('school_periods').where({ id: periodId, tenant_id: tenantId }).first();
  if (!period) throw ApiError.badRequest('Año escolar no encontrado.', [{ path: 'schoolPeriodId', message: 'Año inválido.' }]);

  let term = null;
  if (termNumber) {
    term = await trx('terms').where({ tenant_id: tenantId, school_period_id: periodId, term_number: termNumber }).first();
    if (!term) throw ApiError.badRequest(`El año ${period.name} no tiene el lapso ${termNumber}.`, [{ path: 'termNumber', message: 'Lapso inválido.' }]);
  } else {
    term = await trx('terms')
      .where({ tenant_id: tenantId, school_period_id: periodId })
      .andWhere('start_date', '<=', occurredOn)
      .andWhere('end_date', '>=', occurredOn)
      .first();
  }

  const enrollment = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'sec.school_period_id': periodId })
    .orderByRaw("(e.status = 'active') DESC")
    .select('e.section_id')
    .first();
  return { school_period_id: periodId, term_id: term?.id || null, section_id: enrollment?.section_id || null };
}

function assertDate(occurredOn) {
  if (occurredOn > today()) throw ApiError.badRequest('La fecha de la falta no puede ser futura.', [{ path: 'occurredOn', message: 'Fecha futura.' }]);
}

async function createSanction(trx, tenantId, userId, studentId, data) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).first();
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  assertDate(data.occurredOn);
  const ctx = await resolveContext(trx, tenantId, studentId, data);
  const [row] = await trx('student_sanctions')
    .insert({
      tenant_id: tenantId,
      student_id: studentId,
      ...ctx,
      severity: data.severity,
      fault_type: data.faultType.trim(),
      description: data.description.trim(),
      measure: data.measure?.trim() || null,
      occurred_on: data.occurredOn,
      registered_by: userId,
    })
    .returning('id');
  return format(await baseQuery(trx, tenantId).andWhere('ss.id', row.id).first());
}

async function updateSanction(trx, tenantId, userId, id, data) {
  const current = await loadSanction(trx, tenantId, id);
  const occurredOn = data.occurredOn || String(current.occurred_on instanceof Date ? current.occurred_on.toISOString().slice(0, 10) : current.occurred_on).slice(0, 10);
  assertDate(occurredOn);
  const ctx = await resolveContext(trx, tenantId, current.student_id, {
    schoolPeriodId: data.schoolPeriodId || current.school_period_id,
    termNumber: data.termNumber,
    occurredOn,
  });
  const payload = {
    ...ctx,
    severity: data.severity,
    fault_type: data.faultType?.trim(),
    description: data.description?.trim(),
    measure: data.measure === undefined ? undefined : data.measure?.trim() || null,
    occurred_on: occurredOn,
    updated_by: userId,
    updated_at: trx.fn.now(),
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  // Sin lapso explícito ni fecha nueva, se conserva el lapso que tenía.
  if (!data.termNumber && !data.occurredOn && !data.schoolPeriodId) payload.term_id = current.term_id;
  await trx('student_sanctions').where({ id }).update(payload);
  return format(await baseQuery(trx, tenantId).andWhere('ss.id', id).first());
}

async function deleteSanction(trx, tenantId, id) {
  await loadSanction(trx, tenantId, id);
  await trx('student_sanctions').where({ id }).delete();
  return { ok: true };
}

/**
 * Historial disciplinario para el PORTAL del representante: solo lo que la
 * familia necesita (gravedad, tipo de falta, motivo, medida, fecha, lapso y
 * sección), sin datos internos (quién la registró o editó).
 */
async function getStudentSanctionsForGuardian(trx, tenantId, studentId) {
  const { student, items, totals } = await getStudentSanctions(trx, tenantId, studentId);
  return {
    student,
    totals,
    items: items.map((s) => ({
      id: s.id,
      severity: s.severity,
      severity_label: s.severity_label,
      fault_type: s.fault_type,
      description: s.description,
      measure: s.measure,
      occurred_on: s.occurred_on,
      school_period_name: s.school_period_name,
      term_id: s.term_id,
      term_number: s.term_number,
      term_name: s.term_name,
      grade_name: s.grade_name,
      section_name: s.section_name,
    })),
  };
}

module.exports = { getStudentSanctionsForGuardian, SEVERITIES, SEVERITY_KEYS, listSanctions, getStudentSanctions, loadSanction, createSanction, updateSanction, deleteSanction };
