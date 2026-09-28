const { ApiError } = require('../../utils/ApiError');
const { getGradeById, getSectionById } = require('./academic.service');

/**
 * Niveles educativos, materias, plan de estudios por grado y asignación docente.
 *
 * Las reglas de cada nivel se leen de `education_levels` (migrations/002):
 *   assignment_mode = 'homeroom' → docente(s) de aula por sección (teacher_sections)
 *     allows_assistant = true    → titular + auxiliar (Inicial)
 *     allows_assistant = false   → solo titular (Primaria)
 *   assignment_mode = 'subjects' → un profesor por materia y sección (Secundaria)
 *   has_curriculum = true        → el grado tiene plan de estudios por materias
 *                                  (Primaria y Secundaria; migrations/009). En
 *                                  Primaria el titular dicta todas las materias y
 *                                  se puede asignar un especialista por materia.
 *
 * Un docente puede figurar en cualquier cantidad de asignaciones: varias
 * secciones, varias materias, varios grados.
 */

const fullName = (s) => `${s.first_name} ${s.last_name}`;

// ---------- Niveles ----------

async function listLevels(trx) {
  return trx('education_levels').orderBy('sort_order');
}

// ---------- Validación de docentes ----------

/**
 * Verifica que todos los ids sean personal docente activo del colegio.
 * Devuelve un Map id → fila de staff. Los mensajes nombran al docente para
 * que el coordinador sepa exactamente qué corregir.
 */
async function assertTeachers(trx, tenantId, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await trx('staff').where('tenant_id', tenantId).whereIn('id', unique);
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const id of unique) {
    const staff = byId.get(id);
    if (!staff) throw ApiError.badRequest('Uno de los docentes seleccionados no existe en este colegio.');
    if (staff.staff_type !== 'teaching') {
      throw ApiError.unprocessable(`${fullName(staff)} no es personal docente; solo los docentes pueden recibir asignaciones.`);
    }
    if (staff.status !== 'active') {
      throw ApiError.unprocessable(`${fullName(staff)} está inactivo y no puede recibir asignaciones.`);
    }
  }
  return byId;
}

// ---------- Materias (catálogo) ----------

async function listSubjects(trx, tenantId, { activeOnly } = {}) {
  const query = trx('subjects as s')
    .where('s.tenant_id', tenantId)
    .select(
      's.*',
      trx.raw('(SELECT count(*)::int FROM grade_subjects gs WHERE gs.subject_id = s.id) AS grade_count'),
      trx.raw('(SELECT count(*)::int FROM teacher_subject_sections t WHERE t.subject_id = s.id) AS assignment_count')
    )
    .orderBy('s.name');
  if (activeOnly) query.andWhere('s.is_active', true);
  return query;
}

async function getSubjectById(trx, tenantId, id) {
  const subject = await trx('subjects').where({ id, tenant_id: tenantId }).first();
  if (!subject) throw ApiError.notFound('Materia no encontrada.');
  return subject;
}

/** Traduce la violación de los índices únicos de `subjects` a un 409 con el campo afectado. */
async function withSubjectUniqueness(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505' && /ux_subjects_tenant_name/.test(err.constraint || err.message)) {
      throw ApiError.conflict('Ya existe una materia con ese nombre.', [{ path: 'name', message: 'Nombre repetido.' }]);
    }
    if (err.code === '23505' && /ux_subjects_tenant_code/.test(err.constraint || err.message)) {
      throw ApiError.conflict('Ya existe una materia con esa abreviatura.', [{ path: 'code', message: 'Abreviatura repetida.' }]);
    }
    throw err;
  }
}

async function createSubject(trx, tenantId, { name, code, description }) {
  // SAVEPOINT: si el INSERT choca con el índice único, la transacción del request sigue usable.
  return withSubjectUniqueness(() =>
    trx.transaction(async (sp) => {
      const [subject] = await sp('subjects')
        .insert({ tenant_id: tenantId, name, code: code || null, description: description || null })
        .returning('*');
      return subject;
    })
  );
}

async function updateSubject(trx, tenantId, id, { name, code, description, isActive }) {
  await getSubjectById(trx, tenantId, id);
  const payload = {
    name,
    code: code === '' ? null : code,
    description: description === '' ? null : description,
    is_active: isActive,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  return withSubjectUniqueness(() =>
    trx.transaction(async (sp) => {
      const [subject] = await sp('subjects').where({ id }).update(payload).returning('*');
      return subject;
    })
  );
}

async function deleteSubject(trx, tenantId, id) {
  const subject = await getSubjectById(trx, tenantId, id);

  const grades = await trx('grade_subjects as gs')
    .join('grades as g', 'g.id', 'gs.grade_id')
    .where('gs.subject_id', id)
    .pluck('g.name');
  if (grades.length) {
    throw ApiError.conflict(
      `No se puede eliminar "${subject.name}": está en el plan de estudios de ${grades.join(', ')}. ` +
        'Quítala de esos grados o márcala como inactiva.'
    );
  }

  const plans = await trx('evaluation_plans').where({ subject_id: id }).count('id as n').first();
  if (Number(plans.n) > 0) {
    throw ApiError.conflict(
      `No se puede eliminar "${subject.name}": tiene ${plans.n} plan(es) de evaluación. Márcala como inactiva.`
    );
  }

  await trx('subjects').where({ id }).delete();
}

// ---------- Plan de estudios del grado (primaria y secundaria) ----------

async function getGradeSubjects(trx, tenantId, gradeId) {
  const grade = await getGradeById(trx, tenantId, gradeId);
  const subjects = await trx('grade_subjects as gs')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .where('gs.grade_id', gradeId)
    .select(
      's.id',
      's.name',
      's.code',
      's.is_active',
      'gs.weekly_hours',
      'gs.sort_order',
      trx.raw(
        '(SELECT count(*)::int FROM teacher_subject_sections t WHERE t.grade_id = gs.grade_id AND t.subject_id = gs.subject_id) AS assigned_sections'
      )
    )
    .orderBy(['gs.sort_order', 's.name']);
  return { grade, subjects };
}

/**
 * Reemplaza el plan de estudios del grado por la lista recibida (en ese orden).
 * Quitar una materia elimina en cascada sus asignaciones docentes en las
 * secciones del grado; se bloquea si ya hay planes de evaluación de esa
 * materia en el grado, para no dejar planes huérfanos del currículo.
 */
async function setGradeSubjects(trx, tenantId, gradeId, { subjects }) {
  const grade = await getGradeById(trx, tenantId, gradeId);
  if (!grade.has_curriculum) {
    throw ApiError.unprocessable(
      `Los grados de ${grade.level_name} no se organizan por materias: se asigna un docente de aula por sección.`
    );
  }

  const ids = subjects.map((s) => s.subjectId);
  if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Hay materias repetidas en la lista.');

  const found = ids.length ? await trx('subjects').where('tenant_id', tenantId).whereIn('id', ids) : [];
  if (found.length !== ids.length) throw ApiError.badRequest('Una de las materias seleccionadas no existe.');

  const current = await trx('grade_subjects').where({ grade_id: gradeId });
  const removed = current.filter((c) => !ids.includes(c.subject_id)).map((c) => c.subject_id);

  if (removed.length) {
    const withPlans = await trx('evaluation_plans as ep')
      .join('sections as sec', 'sec.id', 'ep.section_id')
      .join('subjects as s', 's.id', 'ep.subject_id')
      .where('sec.grade_id', gradeId)
      .whereIn('ep.subject_id', removed)
      .distinct('s.name')
      .pluck('s.name');
    if (withPlans.length) {
      throw ApiError.conflict(
        `No se puede quitar ${withPlans.join(', ')} del grado: ya tiene planes de evaluación registrados.`
      );
    }
  }

  const removedAssignments = removed.length
    ? Number(
        (
          await trx('teacher_subject_sections')
            .where({ grade_id: gradeId })
            .whereIn('subject_id', removed)
            .count('id as n')
            .first()
        ).n
      )
    : 0;

  if (removed.length) {
    await trx('grade_subjects').where({ grade_id: gradeId }).whereIn('subject_id', removed).delete();
  }

  for (const [index, item] of subjects.entries()) {
    await trx('grade_subjects')
      .insert({
        tenant_id: tenantId,
        grade_id: gradeId,
        subject_id: item.subjectId,
        weekly_hours: item.weeklyHours ?? null,
        sort_order: index,
      })
      .onConflict(['grade_id', 'subject_id'])
      .merge(['weekly_hours', 'sort_order']);
  }

  return { ...(await getGradeSubjects(trx, tenantId, gradeId)), removedAssignments };
}

// ---------- Asignación docente por sección ----------

/**
 * Estado de la asignación docente de una sección, con la forma que
 * corresponde a su nivel:
 *   { section, mode: 'homeroom', homeroom: { lead, assistant }, subjects: [...] }
 *   { section, mode: 'subjects', subjects: [...] }
 *
 * Cada materia: { id, name, code, weekly_hours, teacher, effectiveTeacher, inherited }
 *   teacher           profesor asignado a ESA materia (Secundaria) o especialista (Primaria)
 *   effectiveTeacher  quién la dicta de verdad: en Primaria, sin especialista, el titular
 *   inherited         true si la dicta el titular por no tener especialista
 * En Inicial (sin plan de estudios) `subjects` es [].
 */
async function getSectionAssignments(trx, tenantId, sectionId) {
  const section = await getSectionById(trx, tenantId, sectionId);
  const subjects = section.has_curriculum ? await listSectionSubjects(trx, section) : [];

  if (section.assignment_mode === 'homeroom') {
    const rows = await trx('teacher_sections as ts')
      .join('staff as st', 'st.id', 'ts.staff_id')
      .where('ts.section_id', sectionId)
      .select('ts.role', 'st.id', 'st.first_name', 'st.last_name');
    const pick = (role) => {
      const r = rows.find((x) => x.role === role);
      return r ? { id: r.id, name: fullName(r) } : null;
    };
    const lead = pick('lead');
    return {
      section,
      mode: 'homeroom',
      homeroom: { lead, assistant: pick('assistant') },
      subjects: subjects.map((s) => ({ ...s, effectiveTeacher: s.teacher || lead, inherited: !s.teacher })),
    };
  }

  return {
    section,
    mode: 'subjects',
    subjects: subjects.map((s) => ({ ...s, effectiveTeacher: s.teacher, inherited: false })),
  };
}

/** Materias del plan de estudios del grado de la sección, con su profesor asignado (si lo hay). */
async function listSectionSubjects(trx, section) {
  const sectionId = section.id;
  const subjects = await trx('grade_subjects as gs')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .leftJoin('teacher_subject_sections as t', function joinAssignment() {
      this.on('t.subject_id', 'gs.subject_id').andOn('t.section_id', trx.raw('?', [sectionId]));
    })
    .leftJoin('staff as st', 'st.id', 't.staff_id')
    .where('gs.grade_id', section.grade_id)
    .select('s.id', 's.name', 's.code', 'gs.weekly_hours', 'st.id as teacher_id', 'st.first_name', 'st.last_name')
    .orderBy(['gs.sort_order', 's.name']);

  return subjects.map(({ teacher_id: teacherId, first_name: first, last_name: last, ...s }) => ({
    ...s,
    teacher: teacherId ? { id: teacherId, name: `${first} ${last}` } : null,
  }));
}

/** Pone `staffId` en el rol `role` de la sección (o lo quita si es null), sin tocar la fecha si no cambia. */
async function setHomeroomRole(trx, tenantId, sectionId, role, staffId) {
  const existing = await trx('teacher_sections').where({ section_id: sectionId, role }).first();
  if (!staffId) {
    if (existing) await trx('teacher_sections').where({ id: existing.id }).delete();
  } else if (!existing) {
    await trx('teacher_sections').insert({ tenant_id: tenantId, section_id: sectionId, staff_id: staffId, role });
  } else if (existing.staff_id !== staffId) {
    await trx('teacher_sections').where({ id: existing.id }).update({ staff_id: staffId, assigned_at: trx.fn.now() });
  }
}

/**
 * Guarda la asignación docente de una sección. El cuerpo se valida contra el
 * nivel REAL del grado en la base de datos (no contra lo que diga el cliente):
 *
 *   homeroom: { leadTeacherId: uuid | null, assistantTeacherId?: uuid | null,
 *               subjects?: [{ subjectId, teacherId: uuid | null }] }   ← especialistas (Primaria)
 *   subjects: { subjects: [{ subjectId, teacherId: uuid | null }] }
 *
 * Solo se tocan las materias incluidas en la lista (una actualización parcial
 * es válida); `teacherId: null` deja la materia sin profesor (en Primaria: la
 * vuelve a dictar el titular). En homeroom, si el cuerpo no trae
 * `leadTeacherId` ni `assistantTeacherId`, los docentes de aula no se tocan.
 */
async function setSectionAssignments(trx, tenantId, sectionId, body) {
  const section = await getSectionById(trx, tenantId, sectionId);
  // Bloquea la sección para que dos coordinadores guardando a la vez no se pisen.
  await trx('sections').where({ id: sectionId }).forUpdate().first();

  if (section.assignment_mode === 'homeroom') {
    if (body.subjects && !section.has_curriculum) {
      throw ApiError.unprocessable(`En ${section.level_name} no se asignan profesores por materia, sino docentes de aula.`);
    }
    const touchesHomeroom = 'leadTeacherId' in body || 'assistantTeacherId' in body;
    if (!touchesHomeroom) {
      await applySubjectTeachers(trx, tenantId, section, body.subjects || []);
      return getSectionAssignments(trx, tenantId, sectionId);
    }
    const lead = body.leadTeacherId ?? null;
    const assistant = body.assistantTeacherId ?? null;

    if (assistant && !section.allows_assistant) {
      throw ApiError.unprocessable(`En ${section.level_name} cada sección tiene un único docente titular, sin auxiliar.`, [
        { path: 'assistantTeacherId', message: 'No aplica en este nivel.' },
      ]);
    }
    if (assistant && !lead) {
      throw ApiError.unprocessable('Asigna primero el docente titular antes que el auxiliar.', [
        { path: 'leadTeacherId', message: 'Requerido si hay auxiliar.' },
      ]);
    }
    if (lead && assistant && lead === assistant) {
      throw ApiError.badRequest('El docente auxiliar no puede ser el mismo que el titular.', [
        { path: 'assistantTeacherId', message: 'Debe ser otro docente.' },
      ]);
    }
    // Solo se validan docentes nuevos en la sección: si uno ya asignado pasó a
    // inactivo, eso no debe impedir guardar otros cambios.
    const current = await trx('teacher_sections').where({ section_id: sectionId }).pluck('staff_id');
    await assertTeachers(trx, tenantId, [lead, assistant].filter((id) => id && !current.includes(id)));

    // Primero se libera el rol auxiliar: permite intercambiar titular ↔ auxiliar
    // sin chocar con UNIQUE (section_id, staff_id).
    await setHomeroomRole(trx, tenantId, sectionId, 'assistant', null);
    await setHomeroomRole(trx, tenantId, sectionId, 'lead', lead);
    await setHomeroomRole(trx, tenantId, sectionId, 'assistant', assistant);
    // Primaria: especialistas por materia en el mismo guardado.
    if (body.subjects) await applySubjectTeachers(trx, tenantId, section, body.subjects);
    return getSectionAssignments(trx, tenantId, sectionId);
  }

  // ---- Secundaria: profesor por materia ----
  if (!Array.isArray(body.subjects)) {
    throw ApiError.unprocessable(`En ${section.level_name} los docentes se asignan por materia.`);
  }
  await applySubjectTeachers(trx, tenantId, section, body.subjects);
  return getSectionAssignments(trx, tenantId, sectionId);
}

/**
 * Profesor por materia en la sección (Secundaria) o especialista (Primaria).
 * Las materias deben estar en el plan de estudios del grado.
 */
async function applySubjectTeachers(trx, tenantId, section, list) {
  const sectionId = section.id;
  const subjectIds = list.map((s) => s.subjectId);
  if (new Set(subjectIds).size !== subjectIds.length) throw ApiError.badRequest('Hay materias repetidas en la lista.');

  const curriculum = await trx('grade_subjects as gs')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .where('gs.grade_id', section.grade_id)
    .select('s.id', 's.name');
  const inCurriculum = new Set(curriculum.map((c) => c.id));
  const outside = subjectIds.filter((id) => !inCurriculum.has(id));
  if (outside.length) {
    throw ApiError.unprocessable(
      `Hay materias que no forman parte del plan de estudios de ${section.grade_name}. Agrégalas primero al grado.`
    );
  }

  const existing = await trx('teacher_subject_sections').where({ section_id: sectionId }).whereIn('subject_id', subjectIds);
  const bySubject = new Map(existing.map((e) => [e.subject_id, e]));

  // Solo se validan asignaciones que cambian (ver comentario en la rama homeroom).
  await assertTeachers(
    trx,
    tenantId,
    list.filter((s) => s.teacherId && bySubject.get(s.subjectId)?.staff_id !== s.teacherId).map((s) => s.teacherId)
  );

  for (const { subjectId, teacherId } of list) {
    const row = bySubject.get(subjectId);
    if (!teacherId) {
      if (row) await trx('teacher_subject_sections').where({ id: row.id }).delete();
    } else if (!row) {
      await trx('teacher_subject_sections').insert({
        tenant_id: tenantId,
        section_id: sectionId,
        grade_id: section.grade_id,
        subject_id: subjectId,
        staff_id: teacherId,
      });
    } else if (row.staff_id !== teacherId) {
      await trx('teacher_subject_sections').where({ id: row.id }).update({ staff_id: teacherId, assigned_at: trx.fn.now() });
    }
  }
}

// ---------- Carga docente ----------

/**
 * Todas las asignaciones agrupadas por docente (incluye docentes activos sin
 * asignaciones, para ver quién está disponible). Filtrable por año escolar.
 */
async function listTeachingLoad(trx, tenantId, { schoolPeriodId } = {}) {
  const teachers = await trx('staff')
    .where({ tenant_id: tenantId, staff_type: 'teaching' })
    .select('id', 'first_name', 'last_name', 'email', 'status')
    .orderBy(['last_name', 'first_name']);

  const base = (q) => {
    q.join('sections as sec', 'sec.id', 't.section_id')
      .join('grades as g', 'g.id', 'sec.grade_id')
      .join('education_levels as el', 'el.code', 'g.level_code')
      .where('t.tenant_id', tenantId);
    if (schoolPeriodId) q.andWhere('sec.school_period_id', schoolPeriodId);
    return q;
  };

  const homeroom = await base(trx('teacher_sections as t')).select(
    't.staff_id',
    't.role',
    'sec.id as section_id',
    'sec.name as section_name',
    'g.name as grade_name',
    'g.level_code',
    'el.name as level_name',
    'el.sort_order as level_order',
    'g.sort_order as grade_order'
  );

  const bySubject = await base(trx('teacher_subject_sections as t'))
    .join('subjects as s', 's.id', 't.subject_id')
    .select(
      't.staff_id',
      's.id as subject_id',
      's.name as subject_name',
      'sec.id as section_id',
      'sec.name as section_name',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      'el.sort_order as level_order',
      'g.sort_order as grade_order'
    );

  const assignments = [
    ...homeroom.map((a) => ({ ...a, type: 'homeroom' })),
    ...bySubject.map((a) => ({ ...a, type: 'subject' })),
  ].sort(
    (a, b) =>
      a.level_order - b.level_order ||
      a.grade_order - b.grade_order ||
      a.grade_name.localeCompare(b.grade_name) ||
      a.section_name.localeCompare(b.section_name) ||
      (a.subject_name || '').localeCompare(b.subject_name || '')
  );

  return teachers.map((t) => {
    const mine = assignments
      .filter((a) => a.staff_id === t.id)
      .map(({ staff_id: _s, level_order: _l, grade_order: _g, ...a }) => a);
    return {
      ...t,
      assignments: mine,
      sectionCount: new Set(mine.map((a) => a.section_id)).size,
      subjectCount: new Set(mine.filter((a) => a.type === 'subject').map((a) => a.subject_id)).size,
      levels: [...new Set(mine.map((a) => a.level_code))],
    };
  });
}

module.exports = {
  listLevels,
  assertTeachers,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  getGradeSubjects,
  setGradeSubjects,
  getSectionAssignments,
  setSectionAssignments,
  listTeachingLoad,
};
