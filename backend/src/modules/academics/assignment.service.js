const { ApiError } = require('../../utils/ApiError');
const { getGradeById, getSectionById } = require('./academic.service');
const { exclusionOf, notExcludedSql } = require('./sectionSubjects');
const staffService = require('../staff/staff.service');

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
 * Un docente puede figurar en varias materias, secciones y grados, salvo una
 * regla: en Inicial y Primaria (docentes de aula) cada docente, titular o
 * auxiliar, atiende UNA sola sección por año escolar (ver homeroomTaken).
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

// ---------- Exclusividad de los docentes de aula (Inicial y Primaria) ----------

const ROLE_LABELS = { lead: 'docente titular', assistant: 'docente auxiliar' };

/**
 * Docentes de aula ya asignados en un año escolar: Map staffId → la sección
 * que atienden { section_id, section_name, grade_name, level_name, role, label }.
 * `label` = "3er Grado · Sección B - Primaria" (para los selectores y los errores).
 */
async function homeroomTaken(trx, tenantId, schoolPeriodId) {
  const rows = await trx('teacher_sections as ts')
    .join('sections as sec', 'sec.id', 'ts.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'ts.tenant_id': tenantId, 'sec.school_period_id': schoolPeriodId })
    .select('ts.staff_id', 'ts.role', 'sec.id as section_id', 'sec.name as section_name', 'g.name as grade_name', 'el.name as level_name')
    .orderBy('ts.assigned_at');
  const map = new Map();
  rows.forEach((r) => {
    if (map.has(r.staff_id)) return; // datos anteriores a la regla: se informa la primera
    const level = r.level_name.replace(/^Educación\s+/i, '');
    map.set(r.staff_id, { ...r, label: `${r.grade_name} · Sección ${r.section_name} - ${level}` });
  });
  return map;
}

/** 422 si algún docente no está disponible para el nivel de la sección (staff.level_availability). */
function assertLevelAvailable(section, staffById, ids) {
  for (const id of ids) {
    const staff = staffById.get(id);
    if (staff && !staffService.availableFor(staff, section.level_code)) {
      const only = staffService.LEVEL_AVAILABILITY_LABELS[staff.level_availability];
      throw ApiError.unprocessable(
        `${fullName(staff)} está disponible solo para ${only}; esta sección es de ${section.level_name.replace(/^Educación\s+/i, '')}. Cambia su disponibilidad en Personal si corresponde.`,
        [{ path: 'teacherId', message: `Disponible solo para ${only}.` }]
      );
    }
  }
}

/** 409 si alguno de los docentes ya atiende OTRA sección de Inicial o Primaria en el mismo año escolar. */
async function assertHomeroomFree(trx, tenantId, section, staffById, ids) {
  if (!ids.length) return;
  const taken = await homeroomTaken(trx, tenantId, section.school_period_id);
  for (const id of ids) {
    const other = taken.get(id);
    if (other && other.section_id !== section.id) {
      const staff = staffById.get(id) || (await trx('staff').where({ id }).first('first_name', 'last_name'));
      throw ApiError.conflict(
        `${fullName(staff)} ya es ${ROLE_LABELS[other.role]} de ${other.label}. En Inicial y Primaria cada docente atiende una sola sección por año escolar.`,
        [{ path: 'teacherId', message: `Ya asignado a ${other.label}.` }]
      );
    }
  }
}

// ---------- Materias (catálogo) ----------

async function listSubjects(trx, tenantId, { activeOnly } = {}) {
  const query = trx('subjects as s')
    .where('s.tenant_id', tenantId)
    .select(
      's.*',
      trx.raw('(SELECT count(*)::int FROM grade_subjects gs WHERE gs.subject_id = s.id) AS grade_count'),
      trx.raw('(SELECT count(*)::int FROM teacher_subject_sections t WHERE t.subject_id = s.id) AS assignment_count'),
      // Grados donde se dicta (para el selector múltiple del formulario de la materia).
      trx.raw("COALESCE((SELECT array_agg(gs.grade_id) FROM grade_subjects gs WHERE gs.subject_id = s.id), '{}') AS grade_ids")
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

// ---------- Grados de una materia (selector múltiple de la materia) ----------

/**
 * Define en qué grados se dicta una materia: agrega la materia al plan de
 * estudios (grade_subjects) de los grados nuevos, al final de su lista, y la
 * quita de los que ya no vienen. Mismas reglas que al editar el plan de un
 * grado: no se quita de un grado donde ya tiene planes de evaluación, y una
 * materia inactiva no se agrega a grados nuevos.
 */
async function setSubjectGrades(trx, tenantId, subjectId, gradeIds) {
  const subject = await getSubjectById(trx, tenantId, subjectId);
  const ids = [...new Set(gradeIds)];
  const grades = ids.length
    ? await trx('grades as g')
        .join('education_levels as el', 'el.code', 'g.level_code')
        .where('g.tenant_id', tenantId)
        .whereIn('g.id', ids)
        .select('g.id', 'g.name', 'el.name as level_name', 'el.has_curriculum')
    : [];
  if (grades.length !== ids.length) throw ApiError.badRequest('Hay grados que no existen en el colegio.', [{ path: 'gradeIds', message: 'Grado inválido.' }]);
  const noCurriculum = grades.filter((g) => !g.has_curriculum);
  if (noCurriculum.length) {
    throw ApiError.unprocessable(`Los grados de ${noCurriculum[0].level_name} no se organizan por materias.`, [{ path: 'gradeIds', message: 'Nivel sin plan de estudios.' }]);
  }

  const current = await trx('grade_subjects').where({ subject_id: subjectId }).pluck('grade_id');
  const added = ids.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !ids.includes(id));
  if (added.length && !subject.is_active) {
    throw ApiError.unprocessable(`${subject.name} está inactiva: actívala antes de agregarla a más grados.`, [{ path: 'gradeIds', message: 'Materia inactiva.' }]);
  }

  if (removed.length) {
    const withPlans = await trx('evaluation_plans as ep')
      .join('sections as sec', 'sec.id', 'ep.section_id')
      .join('grades as g', 'g.id', 'sec.grade_id')
      .where('ep.subject_id', subjectId)
      .whereIn('sec.grade_id', removed)
      .distinct('g.name')
      .pluck('g.name');
    if (withPlans.length) {
      throw ApiError.conflict(`No se puede quitar ${subject.name} de ${withPlans.join(', ')}: ya tiene planes de evaluación registrados.`, [
        { path: 'gradeIds', message: 'Grado con planes.' },
      ]);
    }
    // Las asignaciones docentes y clases del horario de esa materia en esos grados se van en cascada.
    await trx('grade_subjects').where({ subject_id: subjectId }).whereIn('grade_id', removed).delete();
  }
  for (const gradeId of added) {
    const { max } = await trx('grade_subjects').where({ grade_id: gradeId }).max('sort_order as max').first();
    await trx('grade_subjects').insert({ tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId, sort_order: max === null ? 0 : Number(max) + 1 });
  }
  return { added: added.length, removed: removed.length };
}

/** Materia con sus grados (la misma forma que una fila de listSubjects). */
async function getSubjectWithGrades(trx, tenantId, subjectId) {
  return (await listSubjects(trx, tenantId)).find((x) => x.id === subjectId);
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

  // Las clases del horario de esas materias se borran en cascada: se informa cuántas.
  const removedScheduleClasses = removed.length
    ? Number((await trx('class_schedules').where({ grade_id: gradeId }).whereIn('subject_id', removed).count('id as n').first()).n)
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

  return { ...(await getGradeSubjects(trx, tenantId, gradeId)), removedAssignments, removedScheduleClasses };
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
    // Docentes que ya atienden OTRA sección de Inicial o Primaria en este año (no seleccionables aquí).
    const taken = [...(await homeroomTaken(trx, tenantId, section.school_period_id)).values()]
      .filter((t) => t.section_id !== sectionId)
      .map((t) => ({ staff_id: t.staff_id, section_id: t.section_id, role: t.role, label: t.label }));
    return {
      section,
      mode: 'homeroom',
      homeroom: { lead, assistant: pick('assistant') },
      taken,
      subjects: subjects.map((s) => ({ ...s, effectiveTeacher: s.teacher || lead, inherited: !s.teacher })),
    };
  }

  const guide = section.guide_teacher_id
    ? await trx('staff').where({ id: section.guide_teacher_id }).select('id', 'first_name', 'last_name').first()
    : null;
  return {
    section,
    mode: 'subjects',
    // Profesor guía / tutor del grupo (opcional, solo Secundaria).
    guide: guide ? { id: guide.id, name: fullName(guide) } : null,
    subjects: subjects.map((s) => ({ ...s, effectiveTeacher: s.teacher, inherited: false })),
  };
}

/** Materias de la sección (plan de su grado menos las excluidas de ella), con su profesor asignado (si lo hay). */
async function listSectionSubjects(trx, section) {
  const sectionId = section.id;
  const subjects = await trx('grade_subjects as gs')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .leftJoin('teacher_subject_sections as t', function joinAssignment() {
      this.on('t.subject_id', 'gs.subject_id').andOn('t.section_id', trx.raw('?', [sectionId]));
    })
    .leftJoin('staff as st', 'st.id', 't.staff_id')
    .where('gs.grade_id', section.grade_id)
    // Sin las materias excluidas de esta sección (migración 037).
    .whereNotExists(exclusionOf(trx, sectionId, trx.ref('gs.subject_id')))
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
    if (body.guideTeacherId) {
      throw ApiError.unprocessable(`El profesor guía es de Secundaria: en ${section.level_name} el responsable del grupo es el docente titular.`, [
        { path: 'guideTeacherId', message: 'No aplica en este nivel.' },
      ]);
    }
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
    const incoming = [lead, assistant].filter((id) => id && !current.includes(id));
    const staffById = await assertTeachers(trx, tenantId, incoming);
    assertLevelAvailable(section, staffById, incoming);
    // Exclusividad: quien ya atiende otra sección de Inicial o Primaria en el año no puede sumar esta.
    await assertHomeroomFree(trx, tenantId, section, staffById, incoming);

    // Primero se libera el rol auxiliar: permite intercambiar titular ↔ auxiliar
    // sin chocar con UNIQUE (section_id, staff_id).
    await setHomeroomRole(trx, tenantId, sectionId, 'assistant', null);
    await setHomeroomRole(trx, tenantId, sectionId, 'lead', lead);
    await setHomeroomRole(trx, tenantId, sectionId, 'assistant', assistant);
    // Primaria: especialistas por materia en el mismo guardado.
    if (body.subjects) await applySubjectTeachers(trx, tenantId, section, body.subjects);
    return getSectionAssignments(trx, tenantId, sectionId);
  }

  // ---- Secundaria: profesor por materia y profesor guía (opcional) ----
  if (!Array.isArray(body.subjects) && !('guideTeacherId' in body)) {
    throw ApiError.unprocessable(`En ${section.level_name} los docentes se asignan por materia.`);
  }
  if ('guideTeacherId' in body) {
    const guideId = body.guideTeacherId || null;
    if (guideId && guideId !== section.guide_teacher_id) assertLevelAvailable(section, await assertTeachers(trx, tenantId, [guideId]), [guideId]);
    await trx('sections').where({ id: sectionId }).update({ guide_teacher_id: guideId });
  }
  if (Array.isArray(body.subjects)) await applySubjectTeachers(trx, tenantId, section, body.subjects);
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
    .select('s.id', 's.name', trx.raw(`${notExcludedSql('?', 'gs.subject_id')} AS available`, [sectionId]));
  const inCurriculum = new Set(curriculum.map((c) => c.id));
  const outside = subjectIds.filter((id) => !inCurriculum.has(id));
  if (outside.length) {
    throw ApiError.unprocessable(
      `Hay materias que no forman parte del plan de estudios de ${section.grade_name}. Agrégalas primero al grado.`
    );
  }
  const excluded = curriculum.filter((c) => !c.available && subjectIds.includes(c.id));
  if (excluded.length) {
    throw ApiError.unprocessable(`${excluded[0].name} no se dicta en ${section.grade_name} ${section.name}: márcala para esa sección en Materias.`);
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

// ---------- Matriz plana: grado/sección → materia → profesor ----------

/**
 * Una fila por (sección, materia del plan de estudios) del año, con su
 * profesor en campos PLANOS, en una sola consulta:
 *   { level_name, grade_id, grade_name, section_id, section_name, subject_id,
 *     subject_name, weekly_hours, teacher_id, teacher_name, teacher_source }
 * teacher_source: 'subject'  profesor asignado a esa materia (o especialista en Primaria)
 *                 'homeroom' Primaria sin especialista: la dicta el docente titular
 *                 null       SIN profesor (vacante)
 * Filtros opcionales: gradeId, sectionId, teacherId. Orden de la jerarquía escolar.
 */
async function listAssignmentMatrix(trx, tenantId, { schoolPeriodId, gradeId = null, sectionId = null, teacherId = null }) {
  const rows = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('grade_subjects as gs', 'gs.grade_id', 'g.id')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .leftJoin('teacher_subject_sections as t', function onSubject() {
      this.on('t.section_id', 'sec.id').andOn('t.subject_id', 's.id');
    })
    .leftJoin('staff as st', 'st.id', 't.staff_id')
    .leftJoin('teacher_sections as ts', function onLead() {
      this.on('ts.section_id', 'sec.id').andOn('ts.role', trx.raw('?', ['lead'])).andOn('el.assignment_mode', trx.raw('?', ['homeroom']));
    })
    .leftJoin('staff as lead', 'lead.id', 'ts.staff_id')
    .where({ 'sec.tenant_id': tenantId, 'sec.school_period_id': schoolPeriodId })
    .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), trx.ref('s.id')))
    .modify((q) => {
      if (gradeId) q.andWhere('g.id', gradeId);
      if (sectionId) q.andWhere('sec.id', sectionId);
      if (teacherId) q.andWhere(trx.raw('COALESCE(st.id, lead.id)'), teacherId);
    })
    .select(
      'el.code as level_code',
      'el.name as level_name',
      'g.id as grade_id',
      'g.name as grade_name',
      'sec.id as section_id',
      'sec.name as section_name',
      's.id as subject_id',
      's.name as subject_name',
      'gs.weekly_hours',
      trx.raw('COALESCE(st.id, lead.id) AS teacher_id'),
      trx.raw("COALESCE(st.first_name || ' ' || st.last_name, lead.first_name || ' ' || lead.last_name) AS teacher_name"),
      trx.raw("CASE WHEN st.id IS NOT NULL THEN 'subject' WHEN lead.id IS NOT NULL THEN 'homeroom' END AS teacher_source")
    )
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'g.name' }, { column: 'sec.name' }, { column: 'gs.sort_order' }, { column: 's.name' }]);

  const unassigned = rows.filter((r) => !r.teacher_id).length;
  return {
    rows,
    summary: {
      total: rows.length,
      assigned: rows.length - unassigned,
      unassigned,
      teachers: new Set(rows.map((r) => r.teacher_id).filter(Boolean)).size,
      sections: new Set(rows.map((r) => r.section_id)).size,
    },
  };
}

// ---------- Carga docente ----------

/**
 * Todas las asignaciones agrupadas por docente (incluye docentes activos sin
 * asignaciones, para ver quién está disponible). Filtrable por año escolar.
 */
async function listTeachingLoad(trx, tenantId, { schoolPeriodId } = {}) {
  const levelCol = (await staffService.hasLevelColumn(trx)) ? ['level_availability'] : [];
  const teachers = await trx('staff')
    .where({ tenant_id: tenantId, staff_type: 'teaching' })
    .select('id', 'first_name', 'last_name', 'email', 'status', ...levelCol)
    .orderBy(['first_name', 'last_name']); // orden alfabético por el nombre que se muestra (Nombre Apellido)

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

/**
 * Panel de un grado en un año escolar para el módulo de Grados y secciones:
 * SOLO la estructura (secciones y su personal docente según el nivel). Las
 * materias y sus profesores se gestionan en el módulo de Materias
 * (subjectAssignment.service).
 *   grade     datos del grado, reglas de su nivel y cuántas materias tiene
 *   teachers  docentes activos (para los selectores)
 *   sections  secciones del año, cada una con
 *               Inicial     homeroom { lead (docente), assistant (docente auxiliar) }
 *               Primaria    homeroom { lead (docente) }
 *               Secundaria  guide (docente guía)
 *             y subject_count: materias que ve la sección (informativo)
 */
async function getGradePanel(trx, tenantId, gradeId, { schoolPeriodId }) {
  const grade = await getGradeById(trx, tenantId, gradeId);
  const { n: subjectCount } = await trx('grade_subjects').where({ grade_id: gradeId }).count('* as n').first();
  const levelCol = (await staffService.hasLevelColumn(trx)) ? ['level_availability'] : [];
  const teachers = await trx('staff')
    .where({ tenant_id: tenantId, staff_type: 'teaching', status: 'active' })
    .select('id', 'first_name', 'last_name', ...levelCol)
    .orderBy(['first_name', 'last_name']); // orden alfabético por el nombre que se muestra (Nombre Apellido)
  const rows = schoolPeriodId
    ? await trx('sections as sec')
        .leftJoin('staff as guide', 'guide.id', 'sec.guide_teacher_id')
        .where({ 'sec.tenant_id': tenantId, 'sec.grade_id': gradeId, 'sec.school_period_id': schoolPeriodId })
        .select(
          'sec.id',
          'sec.name',
          'sec.max_students',
          'guide.id as guide_id',
          trx.raw("guide.first_name || ' ' || guide.last_name AS guide_name"),
          trx.raw("(SELECT count(*)::int FROM enrollments e WHERE e.section_id = sec.id AND e.status = 'active') AS enrolled"),
          trx.raw(`(SELECT count(*)::int FROM grade_subjects gs WHERE gs.grade_id = sec.grade_id AND ${notExcludedSql('sec.id', 'gs.subject_id')}) AS subject_count`)
        )
        .orderBy('sec.name')
    : [];
  const homeroom = rows.length
    ? await trx('teacher_sections as ts')
        .join('staff as st', 'st.id', 'ts.staff_id')
        .whereIn('ts.section_id', rows.map((r) => r.id))
        .select('ts.section_id', 'ts.role', 'st.id', 'st.first_name', 'st.last_name')
    : [];
  const pick = (sectionId, role) => {
    const r = homeroom.find((h) => h.section_id === sectionId && h.role === role);
    return r ? { id: r.id, name: fullName(r) } : null;
  };
  const isHomeroom = grade.assignment_mode === 'homeroom';
  // Inicial y Primaria: dónde atiende ya cada docente en el año (para bloquearlo en las otras secciones).
  const taken = isHomeroom && schoolPeriodId ? await homeroomTaken(trx, tenantId, schoolPeriodId) : new Map();
  return {
    grade: { ...grade, subject_count: Number(subjectCount) },
    teachers: teachers.map((t) => {
      const h = taken.get(t.id);
      return {
        id: t.id,
        name: fullName(t),
        level_availability: t.level_availability || 'all',
        homeroom: h ? { section_id: h.section_id, role: h.role, label: h.label } : null,
      };
    }),
    sections: rows.map((r) => ({
      id: r.id,
      name: r.name,
      max_students: r.max_students,
      enrolled: r.enrolled,
      subject_count: r.subject_count,
      mode: grade.assignment_mode,
      homeroom: isHomeroom ? { lead: pick(r.id, 'lead'), assistant: pick(r.id, 'assistant') } : null,
      guide: !isHomeroom && r.guide_id ? { id: r.guide_id, name: r.guide_name } : null,
    })),
  };
}

module.exports = {
  setSubjectGrades,
  getSubjectById,
  applySubjectTeachers,
  getSubjectWithGrades,
  listAssignmentMatrix,
  getGradePanel,
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
