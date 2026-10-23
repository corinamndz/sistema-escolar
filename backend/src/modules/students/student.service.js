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
async function listStudents(trx, tenantId, { status, scope = null, availableFor = null } = {}) {
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
  // Solo alumnos SIN inscripción activa en el año escolar de la sección destino.
  if (availableFor) {
    query.whereNotExists(
      trx('enrollments as ex')
        .join('sections as sx', 'sx.id', 'ex.section_id')
        .whereRaw('ex.student_id = s.id')
        .where('ex.status', 'active')
        .whereRaw(
          'sx.school_period_id = (SELECT school_period_id FROM sections WHERE id = ?)',
          [availableFor]
        )
    );
  }
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

/** Crea el alumno y, si viene `data.guardians`, lo asocia a sus representantes en la misma transacción. */
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
  if (data.guardians) await syncGuardiansOfStudent(trx, tenantId, student.id, data.guardians);
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
  const [updated] = Object.keys(payload).length ? await trx('students').where({ id }).update(payload).returning('*') : [await trx('students').where({ id }).first()];
  if (data.guardians) await syncGuardiansOfStudent(trx, tenantId, id, data.guardians);
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
      ), '[]'::json) AS student_names`),
      trx.raw(`COALESCE((
        SELECT json_agg(json_build_object(
          'student_id',  s.id,
          'student_name', s.first_name || ' ' || s.last_name,
          'section_id',  cur.section_id,
          'section_name', cur.section_name,
          'grade_id',    cur.grade_id,
          'grade_name',  cur.grade_name,
          'level_code',  cur.level_code,
          'level_sort',  cur.level_sort,
          'grade_sort',  cur.grade_sort,
          'school_period_name', cur.school_period_name
        ) ORDER BY sg.is_primary DESC, s.last_name, s.first_name)
        FROM student_guardians sg
        JOIN students s ON s.id = sg.student_id
        LEFT JOIN LATERAL (
          SELECT sec.id AS section_id, sec.name AS section_name,
                 gr.id AS grade_id, gr.name AS grade_name, gr.sort_order AS grade_sort,
                 gr.level_code, el.sort_order AS level_sort,
                 sp.name AS school_period_name
          FROM enrollments e
          JOIN sections sec ON sec.id = e.section_id
          JOIN grades gr ON gr.id = sec.grade_id
          JOIN education_levels el ON el.code = gr.level_code
          JOIN school_periods sp ON sp.id = sec.school_period_id
          WHERE e.student_id = s.id AND e.status = 'active'
          ORDER BY sp.is_active DESC, sp.start_date DESC NULLS LAST, e.enrolled_at DESC
          LIMIT 1
        ) cur ON true
        WHERE sg.guardian_id = g.id
      ), '[]'::json) AS students_detail`)
    )
    .orderBy(['g.first_name', 'g.last_name']); // orden alfabético por el nombre que se muestra (Nombre Apellido)
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
  if (data.students) await syncStudentsOfGuardian(trx, tenantId, guardian.id, data.students);
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
  if (data.students) await syncStudentsOfGuardian(trx, tenantId, id, data.students);
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

/**
 * Asociación MÚLTIPLE desde los formularios (N:M, tabla student_guardians).
 * Recibe la lista COMPLETA deseada y aplica la diferencia: agrega los nuevos,
 * actualiza relación / principal de los que siguen y quita los que ya no vienen.
 *
 * `pairs`: [{ studentId, guardianId, relationship, isPrimary }] del lado editado;
 * `side`: { column: 'student_id' | 'guardian_id', id } = qué vínculos se reemplazan.
 * Un alumno tiene a lo sumo un representante principal (índice único, migración 051):
 * marcar a uno como principal le quita la marca al anterior de ese alumno.
 */
async function syncLinks(trx, tenantId, side, pairs) {
  const studentIds = [...new Set(pairs.map((p) => p.studentId))];
  const guardianIds = [...new Set(pairs.map((p) => p.guardianId))];
  // Todos deben ser del colegio activo (si no, el where con tenant_id no los encuentra).
  if (studentIds.length) {
    const found = await trx('students').where({ tenant_id: tenantId }).whereIn('id', studentIds).pluck('id');
    if (found.length !== studentIds.length) throw ApiError.badRequest('Uno de los alumnos elegidos no existe en el colegio.', [{ path: 'students', message: 'Alumno inválido.' }]);
  }
  if (guardianIds.length) {
    const found = await trx('guardians').where({ tenant_id: tenantId }).whereIn('id', guardianIds).pluck('id');
    if (found.length !== guardianIds.length) throw ApiError.badRequest('Uno de los representantes elegidos no existe en el colegio.', [{ path: 'guardians', message: 'Representante inválido.' }]);
  }

  const current = await trx('student_guardians').where(side.column, side.id);
  const keyOf = (r) => `${r.student_id ?? r.studentId}|${r.guardian_id ?? r.guardianId}`;
  const wanted = new Map(pairs.map((p) => [keyOf(p), p]));
  const removed = current.filter((r) => !wanted.has(keyOf(r)));
  if (removed.length) {
    await trx('student_guardians')
      .where(side.column, side.id)
      .whereIn(side.column === 'student_id' ? 'guardian_id' : 'student_id', removed.map((r) => (side.column === 'student_id' ? r.guardian_id : r.student_id)))
      .delete();
  }

  const existing = new Map(current.map((r) => [keyOf(r), r]));
  const added = [];
  // Primero se quitan las marcas de principal que cambian (el índice único no admite dos a la vez).
  for (const p of pairs) {
    if (p.isPrimary) {
      await trx('student_guardians').where({ student_id: p.studentId, is_primary: true }).whereNot({ guardian_id: p.guardianId }).update({ is_primary: false });
    }
  }
  for (const p of pairs) {
    const row = { relationship: p.relationship?.trim() || null, is_primary: Boolean(p.isPrimary) };
    const before = existing.get(keyOf(p));
    if (!before) {
      await trx('student_guardians').insert({ student_id: p.studentId, guardian_id: p.guardianId, ...row });
      added.push(p.studentId);
    } else if (before.relationship !== row.relationship || before.is_primary !== row.is_primary) {
      await trx('student_guardians').where({ student_id: p.studentId, guardian_id: p.guardianId }).update(row);
    }
  }

  // Alumnos inscritos que no tenían representante: sus mensualidades ya se pueden generar.
  for (const studentId of new Set(added)) await tuition.generateTuition(trx, tenantId, { studentId });
  return { added: added.length, removed: removed.length };
}

/** Representantes de un alumno (formulario del alumno): [{ guardianId, relationship, isPrimary }]. */
async function syncGuardiansOfStudent(trx, tenantId, studentId, guardians) {
  if (guardians.filter((g) => g.isPrimary).length > 1) {
    throw ApiError.badRequest('Marca un solo representante principal.', [{ path: 'guardians', message: 'Solo un principal.' }]);
  }
  return syncLinks(trx, tenantId, { column: 'student_id', id: studentId }, guardians.map((g) => ({ ...g, studentId })));
}

/** Alumnos de un representante (formulario del representante): [{ studentId, relationship, isPrimary }]. */
async function syncStudentsOfGuardian(trx, tenantId, guardianId, students) {
  return syncLinks(trx, tenantId, { column: 'guardian_id', id: guardianId }, students.map((s) => ({ ...s, guardianId })));
}

async function unlinkGuardian(trx, tenantId, studentId, guardianId) {
  await getStudentById(trx, tenantId, studentId);
  await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).delete();
}

module.exports = {
  syncGuardiansOfStudent,
  syncStudentsOfGuardian,
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
