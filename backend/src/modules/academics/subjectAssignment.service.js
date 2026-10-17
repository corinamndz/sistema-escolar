const { ApiError } = require('../../utils/ApiError');
const { getSectionById } = require('./academic.service');
const { getSubjectById, setSubjectGrades, applySubjectTeachers } = require('./assignment.service');

/**
 * Módulo de Materias: en qué grados y secciones se dicta cada materia y qué
 * docente la imparte en cada sección.
 *
 *   grade_subjects               la materia se dicta en el grado (todos los años)
 *   section_subject_exclusions   …salvo en estas secciones (migración 037)
 *   teacher_subject_sections     docente de la materia en la sección
 *
 * En Inicial y Primaria la sección sin docente de materia la dicta su docente
 * de aula (`homeroom_teacher`); en Secundaria queda sin docente (vacante).
 */

const fullName = (r) => `${r.first_name} ${r.last_name}`;

/** ¿La materia tiene planes de evaluación en la sección (propios o compartidos con ella)? */
const plansInSection = (trx, subjectId, sectionRef) =>
  trx('evaluation_plans as ep')
    .where('ep.subject_id', subjectId)
    .andWhere((q) =>
      q
        .where('ep.section_id', sectionRef)
        .orWhereExists(trx('evaluation_plan_sections as ps').whereRaw('ps.plan_id = ep.id').andWhere('ps.section_id', sectionRef))
    )
    .select(trx.raw('1'));

/**
 * Detalle de una materia para su formulario:
 *   { subject, school_period, grades: [{ id, name, level_code, level_name,
 *     assignment_mode, offered, weekly_hours, sections: [{ id, name, available,
 *     teacher, homeroom_teacher, has_plans }] }], teachers }
 * `grades` incluye todos los grados del colegio (para marcar/desmarcar);
 * `sections` son las del año escolar indicado (vacío si no se indica).
 * Con `subjectId = null` devuelve la misma estructura vacía (materia nueva).
 */
async function getSubjectAssignments(trx, tenantId, subjectId, { schoolPeriodId } = {}) {
  const subject = subjectId ? await getSubjectById(trx, tenantId, subjectId) : null;
  const period = schoolPeriodId ? await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first() : null;
  if (schoolPeriodId && !period) throw ApiError.notFound('Año escolar no encontrado.');

  const grades = await trx('grades as g')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .leftJoin('grade_subjects as gs', (j) => j.on('gs.grade_id', 'g.id').andOn('gs.subject_id', trx.raw('?', [subjectId])))
    .where({ 'g.tenant_id': tenantId, 'el.has_curriculum': true })
    .select(
      'g.id',
      'g.name',
      'g.level_code',
      'el.name as level_name',
      'el.assignment_mode',
      trx.raw('gs.subject_id IS NOT NULL AS offered'),
      'gs.weekly_hours',
      // Temas del contenido programático (se borran si se quita la materia del grado).
      trx.raw('(SELECT count(*)::int FROM programmatic_content pc WHERE pc.grade_id = g.id AND pc.subject_id = ?) AS content_count', [subjectId])
    )
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'g.name' }]);

  const sections = period
    ? await trx('sections as sec')
        .leftJoin('teacher_subject_sections as t', (j) => j.on('t.section_id', 'sec.id').andOn('t.subject_id', trx.raw('?', [subjectId])))
        .leftJoin('staff as st', 'st.id', 't.staff_id')
        .leftJoin('teacher_sections as ts', (j) => j.on('ts.section_id', 'sec.id').andOn('ts.role', trx.raw('?', ['lead'])))
        .leftJoin('staff as lead', 'lead.id', 'ts.staff_id')
        .where({ 'sec.tenant_id': tenantId, 'sec.school_period_id': period.id })
        .select(
          'sec.id',
          'sec.grade_id',
          'sec.name',
          'st.id as teacher_id',
          'st.first_name',
          'st.last_name',
          'lead.id as lead_id',
          trx.raw("lead.first_name || ' ' || lead.last_name AS lead_name"),
          trx.raw('EXISTS (SELECT 1 FROM section_subject_exclusions x WHERE x.section_id = sec.id AND x.subject_id = ?) AS excluded', [subjectId]),
          trx.raw(`EXISTS (${plansInSection(trx, subjectId, trx.ref('sec.id')).toQuery()}) AS has_plans`)
        )
        .orderBy('sec.name')
    : [];

  const teachers = await trx('staff')
    .where({ tenant_id: tenantId, staff_type: 'teaching' })
    .andWhere((q) => q.where('status', 'active').orWhereIn('id', sections.map((s) => s.teacher_id).filter(Boolean)))
    .select('id', 'first_name', 'last_name', 'status')
    .orderBy(['first_name', 'last_name']);

  return {
    subject,
    school_period: period ? { id: period.id, name: period.name, closed: Boolean(period.closed_at) } : null,
    grades: grades.map((g) => ({
      ...g,
      sections: sections
        .filter((s) => s.grade_id === g.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          // Con la materia fuera del grado, ninguna sección la ve.
          available: g.offered && !s.excluded,
          teacher: s.teacher_id ? { id: s.teacher_id, name: fullName(s) } : null,
          // Inicial/Primaria: quién la dicta si no tiene docente propio.
          homeroom_teacher: g.assignment_mode === 'homeroom' && s.lead_id ? { id: s.lead_id, name: s.lead_name } : null,
          has_plans: s.has_plans,
        })),
    })),
    teachers: teachers.map((t) => ({ id: t.id, name: fullName(t), inactive: t.status !== 'active' })),
  };
}

/**
 * Guarda dónde se dicta la materia y quién la imparte:
 *   { schoolPeriodId?, grades: [{ gradeId, weeklyHours?, sections?: [{ sectionId, available, teacherId? }] }] }
 *
 * `grades` es la lista COMPLETA de grados donde se dicta: los que no vienen se
 * quitan (con sus docentes y clases del horario, en cascada; se rechaza si ya
 * tienen planes de evaluación). `sections` es opcional y parcial: solo se
 * tocan las secciones incluidas. `available: false` excluye la materia de la
 * sección; `teacherId` (null = sin docente propio) solo aplica si está disponible.
 * Devuelve el detalle actualizado y cuánto se quitó en cascada.
 */
async function setSubjectAssignments(trx, tenantId, subjectId, { grades }) {
  const subject = await getSubjectById(trx, tenantId, subjectId);
  const gradeIds = grades.map((g) => g.gradeId);
  if (new Set(gradeIds).size !== gradeIds.length) throw ApiError.badRequest('Hay grados repetidos en la lista.', [{ path: 'grades', message: 'Grado repetido.' }]);

  // Lo que se va a ir en cascada al quitar grados (para informarlo).
  const current = await trx('grade_subjects').where({ subject_id: subjectId }).pluck('grade_id');
  const removedGrades = current.filter((id) => !gradeIds.includes(id));
  const count = async (table, q) => Number((await q(trx(table).where({ subject_id: subjectId })).count('* as n').first()).n);
  let removedAssignments = removedGrades.length ? await count('teacher_subject_sections', (q) => q.whereIn('grade_id', removedGrades)) : 0;
  let removedScheduleClasses = removedGrades.length ? await count('class_schedules', (q) => q.whereIn('grade_id', removedGrades)) : 0;
  const removedContents = removedGrades.length ? await count('programmatic_content', (q) => q.whereIn('grade_id', removedGrades)) : 0;

  await setSubjectGrades(trx, tenantId, subjectId, gradeIds);

  for (const item of grades) {
    if (item.weeklyHours !== undefined) {
      await trx('grade_subjects').where({ grade_id: item.gradeId, subject_id: subjectId }).update({ weekly_hours: item.weeklyHours });
    }
    if (!item.sections?.length) continue;

    const ids = item.sections.map((s) => s.sectionId);
    if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Hay secciones repetidas en la lista.', [{ path: 'sections', message: 'Sección repetida.' }]);
    const rows = await trx('sections as sec')
      .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
      .where({ 'sec.tenant_id': tenantId, 'sec.grade_id': item.gradeId })
      .whereIn('sec.id', ids)
      .select('sec.id', 'sp.name as period_name', 'sp.closed_at');
    if (rows.length !== ids.length) {
      throw ApiError.badRequest('Hay secciones que no pertenecen al grado indicado.', [{ path: 'sections', message: 'Sección inválida.' }]);
    }
    const closed = rows.find((r) => r.closed_at);
    if (closed) throw ApiError.unprocessable(`El año escolar ${closed.period_name} está finalizado: sus secciones no se pueden modificar.`);

    const excluded = new Set(
      await trx('section_subject_exclusions').where({ subject_id: subjectId }).whereIn('section_id', ids).pluck('section_id')
    );
    for (const entry of item.sections) {
      const section = await getSectionById(trx, tenantId, entry.sectionId);
      const label = `${section.grade_name} ${section.name}`;
      if (entry.available === false) {
        if (excluded.has(section.id)) continue;
        if (await plansInSection(trx, subjectId, section.id).first()) {
          throw ApiError.conflict(`No se puede quitar ${subject.name} de ${label}: ya tiene planes de evaluación registrados.`, [
            { path: 'sections', message: 'Sección con planes.' },
          ]);
        }
        // El trigger de la migración 037 borra su docente y sus clases del horario.
        removedAssignments += await count('teacher_subject_sections', (q) => q.where({ section_id: section.id }));
        removedScheduleClasses += await count('class_schedules', (q) => q.where({ section_id: section.id }));
        await trx('section_subject_exclusions').insert({ tenant_id: tenantId, section_id: section.id, grade_id: item.gradeId, subject_id: subjectId });
        continue;
      }
      if (excluded.has(section.id)) await trx('section_subject_exclusions').where({ section_id: section.id, subject_id: subjectId }).delete();
      if (entry.teacherId !== undefined) await applySubjectTeachers(trx, tenantId, section, [{ subjectId, teacherId: entry.teacherId }]);
    }
  }

  return { removedAssignments, removedScheduleClasses, removedContents };
}

/**
 * Resumen por materia para la tabla del módulo, en el año indicado:
 *   { [subjectId]: { grades: [{ id, name, level_code, sections, available: [nombres] }],
 *                    sections_available, sections_covered, sections_missing } }
 * Cubierta = tiene docente (propio o, en Inicial/Primaria, el de aula).
 */
async function summarizeSubjects(trx, tenantId, { schoolPeriodId }) {
  const rows = await trx('grade_subjects as gs')
    .join('grades as g', 'g.id', 'gs.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .leftJoin('sections as sec', (j) => j.on('sec.grade_id', 'g.id').andOn('sec.school_period_id', trx.raw('?', [schoolPeriodId || null])))
    .where('gs.tenant_id', tenantId)
    .select(
      'gs.subject_id',
      'g.id as grade_id',
      'g.name as grade_name',
      'g.level_code',
      'sec.id as section_id',
      'sec.name as section_name',
      trx.raw('sec.id IS NOT NULL AND EXISTS (SELECT 1 FROM section_subject_exclusions x WHERE x.section_id = sec.id AND x.subject_id = gs.subject_id) AS excluded'),
      trx.raw('EXISTS (SELECT 1 FROM teacher_subject_sections t WHERE t.section_id = sec.id AND t.subject_id = gs.subject_id) AS has_teacher'),
      trx.raw(
        "el.assignment_mode = 'homeroom' AND EXISTS (SELECT 1 FROM teacher_sections ts WHERE ts.section_id = sec.id AND ts.role = 'lead') AS has_homeroom"
      )
    )
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'g.name' }, { column: 'sec.name' }]);

  const out = {};
  for (const r of rows) {
    const s = (out[r.subject_id] ||= { grades: [], sections_available: 0, sections_covered: 0, sections_missing: 0 });
    let grade = s.grades.find((g) => g.id === r.grade_id);
    if (!grade) {
      grade = { id: r.grade_id, name: r.grade_name, level_code: r.level_code, sections: 0, available: [] };
      s.grades.push(grade);
    }
    if (!r.section_id) continue;
    grade.sections += 1;
    if (r.excluded) continue;
    grade.available.push(r.section_name);
    s.sections_available += 1;
    if (r.has_teacher || r.has_homeroom) s.sections_covered += 1;
    else s.sections_missing += 1;
  }
  return out;
}

module.exports = { getSubjectAssignments, setSubjectAssignments, summarizeSubjects };
