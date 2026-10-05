const { ApiError } = require('../../utils/ApiError');

// ---------- Lapsos/periodos ----------

async function listTerms(trx, tenantId, { schoolPeriodId } = {}) {
  const query = trx('terms').where({ tenant_id: tenantId }).orderBy('start_date');
  if (schoolPeriodId) query.andWhere({ school_period_id: schoolPeriodId });
  return query;
}

async function createTerm(trx, tenantId, { schoolPeriodId, name, startDate, endDate }) {
  const [term] = await trx('terms')
    .insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, name, start_date: startDate, end_date: endDate })
    .returning('*');
  return term;
}

// ---------- Planes de evaluación ----------

async function listPlans(trx, tenantId, { sectionId, termId, teacherId } = {}) {
  const query = trx('evaluation_plans as ep')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('staff as st', 'st.id', 'ep.teacher_id')
    .where('ep.tenant_id', tenantId)
    .select(
      'ep.*',
      'sec.name as section_name',
      'g.name as grade_name',
      'g.level_code',
      'el.name as level_name',
      't.name as term_name',
      trx.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
      // Todas las secciones a las que se aplica el plan ("A, B").
      trx.raw(
        `(SELECT string_agg(s2.name, ', ' ORDER BY s2.name) FROM evaluation_plan_sections x
          JOIN sections s2 ON s2.id = x.section_id WHERE x.plan_id = ep.id) AS section_names`
      ),
      // Avance del plan: cuántas actividades tiene y cuánto suman sus porcentajes.
      trx.raw('(SELECT count(*)::int FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS activity_count'),
      trx.raw('(SELECT COALESCE(sum(a.weight_percent), 0)::float FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS total_weight')
    )
    .orderBy('ep.created_at', 'desc');
  // Filtrar por sección incluye los planes compartidos en los que participa.
  if (sectionId) {
    query.whereExists(trx('evaluation_plan_sections as x').whereRaw('x.plan_id = ep.id').andWhere('x.section_id', sectionId));
  }
  if (termId) query.andWhere('ep.term_id', termId);
  if (teacherId) query.andWhere('ep.teacher_id', teacherId);
  return query;
}

/** Secciones del plan (la principal primero). */
async function listPlanSections(trx, planId) {
  return trx('evaluation_plan_sections as x')
    .join('sections as s', 's.id', 'x.section_id')
    .join('evaluation_plans as ep', 'ep.id', 'x.plan_id')
    .where('x.plan_id', planId)
    .select('s.id', 's.name', trx.raw('(s.id = ep.section_id) AS is_main'))
    .orderByRaw('(s.id = ep.section_id) DESC, s.name');
}

/**
 * Estructura detallada de varias actividades: criterios con sus indicadores,
 * fechas de aplicación por sección y si ya tienen notas. Map activityId → datos.
 */
async function loadActivityStructure(trx, activityIds) {
  if (activityIds.length === 0) return new Map();
  const [criteria, indicators, dates, scored] = [
    await trx('evaluation_criteria').whereIn('activity_id', activityIds).orderBy('position'),
    await trx('evaluation_indicators').whereIn('activity_id', activityIds).orderBy('position'),
    await trx('activity_section_dates').whereIn('activity_id', activityIds),
    await trx('activity_scores').whereIn('evaluation_activity_id', activityIds).distinct('evaluation_activity_id').pluck('evaluation_activity_id'),
  ];
  const map = new Map();
  activityIds.forEach((id) => {
    map.set(id, {
      criteria: criteria
        .filter((c) => c.activity_id === id)
        .map((c) => ({
          id: c.id,
          title: c.title,
          position: c.position,
          indicators: indicators
            .filter((i) => i.criterion_id === c.id)
            .map((i) => ({ id: i.id, description: i.description, points: Number(i.points), position: i.position })),
        })),
      section_dates: dates.filter((d) => d.activity_id === id).map((d) => ({ section_id: d.section_id, applied_on: d.applied_on })),
      has_scores: scored.includes(id),
    });
  });
  return map;
}

async function getPlanWithActivities(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .join('sections as sec', 'sec.id', 'ep.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .select('ep.*', 't.name as term_name', 't.start_date as term_start', 't.end_date as term_end', 'g.name as grade_name', 'sec.grade_id')
    .first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  const rows = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .orderByRaw('planned_date ASC NULLS LAST, created_at ASC');
  const structure = await loadActivityStructure(trx, rows.map((a) => a.id));
  const activities = rows.map((a) => ({ ...a, max_score: Number(a.max_score), ...structure.get(a.id) }));

  // Redondeo a centésimas: los porcentajes son NUMERIC(5,2) y 33.33 + 33.33 + 33.34 debe dar 100.
  const totalWeight = Math.round(activities.reduce((sum, a) => sum + Number(a.weight_percent), 0) * 100) / 100;

  const project = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();

  let competencies = [];
  if (project) {
    competencies = await trx('project_competencies')
      .where({ tenant_id: tenantId, pedagogical_project_id: project.id });
  }

  // Secciones del mismo grado y año que se podrían sumar al plan (para la edición).
  const sections = await listPlanSections(trx, planId);
  const candidates = await trx('sections')
    .where({ tenant_id: tenantId, grade_id: plan.grade_id, school_period_id: trx('sections').where({ id: plan.section_id }).select('school_period_id') })
    .whereNotIn('id', sections.map((s) => s.id))
    .select('id', 'name')
    .orderBy('name');

  return {
    ...plan,
    sections,
    available_sections: candidates,
    activities,
    totalWeight,
    pedagogicalProject: project ? { ...project, competencies } : null,
  };
}

async function loadSection(trx, tenantId, sectionId) {
  const section = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'sec.id': sectionId, 'sec.tenant_id': tenantId })
    .select('sec.*', 'g.name as grade_name', 'el.name as level_name', 'el.assignment_mode', 'el.has_curriculum')
    .first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');
  return section;
}

/**
 * Docente y materia del plan en UNA sección, según el nivel del grado:
 *  - Secundaria: `subjectId` obligatorio; la materia debe tener profesor
 *    asignado en la sección y el plan queda a nombre de ese profesor.
 *  - Primaria (con plan de estudios cargado): `subjectId` obligatorio, de una
 *    materia del plan del grado. Docente: el especialista de esa materia si lo
 *    hay; si no, el titular de la sección.
 *  - Inicial, o Primaria cuyo grado aún no tiene materias: `subject` es un
 *    área de texto libre y el docente debe ser el titular o el auxiliar.
 * Devuelve { teacherId, subject, subjectId (o null si es área libre) }.
 */
async function resolveSectionTeacher(trx, section, { teacherId: requestedTeacherId, subject: subjectText, subjectId }) {
  const where = `la sección ${section.name}`;
  let teacherId = requestedTeacherId;
  let subject = subjectText?.trim();

  const curriculumSize = section.has_curriculum
    ? Number((await trx('grade_subjects').where({ grade_id: section.grade_id }).count('* as n').first()).n)
    : 0;
  const homeroomWithCurriculum = section.assignment_mode === 'homeroom' && curriculumSize > 0;

  if (homeroomWithCurriculum) {
    // ---- Primaria con plan de estudios ----
    if (!subjectId) {
      throw ApiError.badRequest(`En ${section.grade_name} el plan debe asociarse a una materia del plan de estudios.`, [
        { path: 'subjectId', message: 'Selecciona la materia.' },
      ]);
    }
    const inCurriculum = await trx('grade_subjects as gs')
      .join('subjects as s', 's.id', 'gs.subject_id')
      .where({ 'gs.grade_id': section.grade_id, 'gs.subject_id': subjectId })
      .select('s.name')
      .first();
    if (!inCurriculum) {
      throw ApiError.unprocessable(`Esa materia no forma parte del plan de estudios de ${section.grade_name}.`, [
        { path: 'subjectId', message: 'No está en el plan de estudios.' },
      ]);
    }
    const specialist = await trx('teacher_subject_sections as t')
      .join('staff as st', 'st.id', 't.staff_id')
      .where({ 't.section_id': section.id, 't.subject_id': subjectId })
      .select('t.staff_id', 'st.first_name', 'st.last_name')
      .first();
    if (specialist) {
      if (teacherId && teacherId !== specialist.staff_id) {
        throw ApiError.unprocessable(
          `${inCurriculum.name} en ${where} la dicta el especialista ${specialist.first_name} ${specialist.last_name}.`,
          [{ path: 'teacherId', message: 'No es el docente de la materia.' }]
        );
      }
      teacherId = specialist.staff_id;
    } else {
      const homeroom = await trx('teacher_sections').where({ section_id: section.id }).select('staff_id', 'role');
      const lead = homeroom.find((h) => h.role === 'lead');
      if (!lead) {
        throw ApiError.unprocessable(`${where[0].toUpperCase()}${where.slice(1)} no tiene docente titular. Asígnalo antes de crear planes.`);
      }
      if (teacherId && !homeroom.some((h) => h.staff_id === teacherId)) {
        throw ApiError.unprocessable(`El docente debe ser el titular de ${where} o el especialista de la materia.`, [
          { path: 'teacherId', message: 'No está asignado a esta materia.' },
        ]);
      }
      teacherId = teacherId || lead.staff_id;
    }
    return { teacherId, subject: inCurriculum.name, subjectId };
  }

  if (section.assignment_mode === 'subjects') {
    if (!subjectId) {
      throw ApiError.badRequest(`En ${section.level_name} el plan debe asociarse a una materia del plan de estudios.`, [
        { path: 'subjectId', message: 'Selecciona la materia.' },
      ]);
    }
    const assignment = await trx('teacher_subject_sections as t')
      .join('subjects as s', 's.id', 't.subject_id')
      .join('staff as st', 'st.id', 't.staff_id')
      .where({ 't.section_id': section.id, 't.subject_id': subjectId })
      .select('s.name as subject_name', 't.staff_id', 'st.first_name', 'st.last_name')
      .first();
    if (!assignment) {
      throw ApiError.unprocessable(`Esa materia no tiene profesor asignado en ${where}. Asígnalo primero.`, [
        { path: 'subjectId', message: 'Sin profesor asignado.' },
      ]);
    }
    if (teacherId && teacherId !== assignment.staff_id) {
      throw ApiError.unprocessable(
        `${assignment.subject_name} en ${where} está asignada a ${assignment.first_name} ${assignment.last_name}.`,
        [{ path: 'teacherId', message: 'No es el profesor asignado.' }]
      );
    }
    return { teacherId: assignment.staff_id, subject: assignment.subject_name, subjectId };
  }

  if (!subject) {
    throw ApiError.badRequest('Indica el área o asignatura del plan.', [{ path: 'subject', message: 'Requerido.' }]);
  }
  const homeroom = await trx('teacher_sections').where({ section_id: section.id }).pluck('staff_id');
  if (homeroom.length === 0) {
    throw ApiError.unprocessable(`${where[0].toUpperCase()}${where.slice(1)} no tiene docente asignado. Asígnalo antes de crear planes.`);
  }
  if (!teacherId || !homeroom.includes(teacherId)) {
    throw ApiError.unprocessable(`El docente debe ser el titular o el auxiliar de ${where}.`, [
      { path: 'teacherId', message: 'No está asignado a esta sección.' },
    ]);
  }
  return { teacherId, subject, subjectId: null };
}

/**
 * Valida un conjunto de secciones para un plan: mismo grado y año escolar, el
 * mismo docente en todas (según su asignación), y que ninguna tenga ya un plan
 * de esa materia en ese lapso. Devuelve { sections, teacherId, subject, subjectId }.
 */
async function resolvePlanSections(trx, tenantId, sectionIds, input, { termId, excludePlanId = null }) {
  const ids = [...new Set(sectionIds)];
  const sections = [];
  for (const id of ids) sections.push(await loadSection(trx, tenantId, id));
  const main = sections[0];
  const odd = sections.find((s) => s.grade_id !== main.grade_id || s.school_period_id !== main.school_period_id);
  if (odd) {
    throw ApiError.unprocessable(`Todas las secciones del plan deben ser de ${main.grade_name} en el mismo año escolar (${odd.grade_name} ${odd.name} no lo es).`, [
      { path: 'sectionIds', message: 'Mismo grado y año escolar.' },
    ]);
  }

  const term = await trx('terms').where({ id: termId, tenant_id: tenantId }).first();
  if (!term || term.school_period_id !== main.school_period_id) {
    throw ApiError.badRequest('El lapso no pertenece al año escolar de la sección.', [{ path: 'termId', message: 'Lapso inválido.' }]);
  }

  let resolved = null;
  for (const section of sections) {
    const r = await resolveSectionTeacher(trx, section, input);
    if (resolved && r.teacherId !== resolved.teacherId) {
      const [a, b] = await trx('staff').whereIn('id', [resolved.teacherId, r.teacherId]).select('id', 'first_name', 'last_name');
      const name = (id) => [a, b].filter(Boolean).find((s) => s.id === id);
      const other = name(r.teacherId);
      throw ApiError.unprocessable(
        `${r.subject} la dicta otro docente en la sección ${section.name}${other ? ` (${other.first_name} ${other.last_name})` : ''}: un plan compartido debe ser del mismo docente en todas sus secciones.`,
        [{ path: 'sectionIds', message: 'Distinto docente.' }]
      );
    }
    resolved = resolved || r;
  }

  // Una sección no puede tener dos planes de la misma materia, lapso y docente.
  const taken = await trx('evaluation_plan_sections as x')
    .join('evaluation_plans as o', 'o.id', 'x.plan_id')
    .join('sections as s', 's.id', 'x.section_id')
    .where({ 'o.tenant_id': tenantId, 'o.term_id': termId, 'o.teacher_id': resolved.teacherId })
    .whereRaw('lower(o.subject) = lower(?)', [resolved.subject])
    .whereIn('x.section_id', ids)
    .modify((q) => excludePlanId && q.whereNot('o.id', excludePlanId))
    .select('s.name')
    .first();
  if (taken) {
    throw ApiError.conflict(`La sección ${taken.name} ya tiene un plan de ${resolved.subject} para este lapso y docente.`, [
      { path: 'sectionIds', message: 'Sección con plan.' },
    ]);
  }
  return { sections, ...resolved };
}

/**
 * Crea un plan de evaluación para una o varias secciones del mismo grado
 * (`sectionIds`; `sectionId` sigue funcionando para una sola). La primera es la
 * sección principal. `format`: 'simple' (por defecto) o 'detailed'.
 */
async function createPlan(trx, tenantId, { sectionId, sectionIds, termId, format = 'simple', ...input }) {
  const ids = sectionIds?.length ? sectionIds : [sectionId];
  if (!ids[0]) throw ApiError.badRequest('Indica al menos una sección.', [{ path: 'sectionIds', message: 'Requerido.' }]);
  const { sections, teacherId, subject, subjectId } = await resolvePlanSections(trx, tenantId, ids, input, { termId });

  const [plan] = await trx('evaluation_plans')
    .insert({
      tenant_id: tenantId,
      section_id: sections[0].id,
      term_id: termId,
      teacher_id: teacherId,
      subject,
      subject_id: subjectId,
      format,
    })
    .returning('*');
  for (const s of sections) {
    await trx('evaluation_plan_sections').insert({ tenant_id: tenantId, plan_id: plan.id, section_id: s.id });
  }
  return { ...plan, section_ids: sections.map((s) => s.id) };
}

/**
 * Cambia el formato o las secciones de un plan.
 *  - detallado → simple: solo si ninguna actividad tiene criterios/indicadores.
 *  - Quitar una sección: solo si sus alumnos no tienen notas en el plan.
 *  - Agregar: mismas reglas que al crear (grado, docente, sin plan duplicado).
 */
async function updatePlan(trx, tenantId, planId, { format, sectionIds }) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).forUpdate().first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');

  if (format && format !== plan.format) {
    if (format === 'simple') {
      const detailed = await trx('evaluation_indicators as i')
        .join('evaluation_activities as a', 'a.id', 'i.activity_id')
        .where('a.evaluation_plan_id', planId)
        .first();
      if (detailed) {
        throw ApiError.unprocessable('El plan tiene actividades con criterios e indicadores: quítalos antes de pasar al formato simple.', [
          { path: 'format', message: 'Tiene estructura detallada.' },
        ]);
      }
    }
    await trx('evaluation_plans').where({ id: planId }).update({ format });
  }

  if (sectionIds) {
    const current = await trx('evaluation_plan_sections').where({ plan_id: planId }).pluck('section_id');
    const wanted = [...new Set(sectionIds)];
    if (!wanted.includes(plan.section_id)) {
      throw ApiError.unprocessable('La sección principal del plan no se puede quitar.', [{ path: 'sectionIds', message: 'Sección principal.' }]);
    }
    const removed = current.filter((id) => !wanted.includes(id));
    const added = wanted.filter((id) => !current.includes(id));

    for (const sectionId of removed) {
      const graded = await trx('activity_scores as sc')
        .join('evaluation_activities as a', 'a.id', 'sc.evaluation_activity_id')
        .join('enrollments as e', function joinEnrollment() {
          this.on('e.student_id', 'sc.student_id').andOn('e.section_id', trx.raw('?', [sectionId]));
        })
        .join('sections as s', 's.id', 'e.section_id')
        .where('a.evaluation_plan_id', planId)
        .select('s.name')
        .first();
      if (graded) {
        throw ApiError.conflict(`No se puede quitar la sección ${graded.name}: sus alumnos ya tienen notas en este plan.`, [
          { path: 'sectionIds', message: 'Tiene notas.' },
        ]);
      }
    }
    if (added.length) {
      await resolvePlanSections(
        trx,
        tenantId,
        [plan.section_id, ...added],
        { teacherId: plan.teacher_id, subject: plan.subject, subjectId: plan.subject_id },
        { termId: plan.term_id, excludePlanId: planId }
      );
    }
    if (removed.length) {
      await trx('activity_section_dates').whereIn('section_id', removed).whereIn('activity_id', trx('evaluation_activities').where({ evaluation_plan_id: planId }).select('id')).delete();
      await trx('evaluation_plan_sections').where({ plan_id: planId }).whereIn('section_id', removed).delete();
    }
    for (const sectionId of added) {
      await trx('evaluation_plan_sections').insert({ tenant_id: tenantId, plan_id: planId, section_id: sectionId });
    }
  }
  return getPlanWithActivities(trx, tenantId, planId);
}

// ---------- Proyectos pedagógicos y competencias ----------

async function createPedagogicalProject(trx, tenantId, planId, { title, description, competencies = [] }) {
  await getPlanWithActivities(trx, tenantId, planId); // valida que el plan exista

  const existing = await trx('pedagogical_projects')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .first();
  if (existing) throw ApiError.conflict('Este plan ya tiene un proyecto pedagógico.');

  const [project] = await trx('pedagogical_projects')
    .insert({ tenant_id: tenantId, evaluation_plan_id: planId, title, description })
    .returning('*');

  if (competencies.length > 0) {
    await trx('project_competencies').insert(
      competencies.map((description) => ({
        tenant_id: tenantId,
        pedagogical_project_id: project.id,
        description,
      }))
    );
  }

  const createdCompetencies = await trx('project_competencies').where({ pedagogical_project_id: project.id });
  return { ...project, competencies: createdCompetencies };
}

async function addCompetency(trx, tenantId, projectId, { description }) {
  const project = await trx('pedagogical_projects').where({ id: projectId, tenant_id: tenantId }).first();
  if (!project) throw ApiError.notFound('Proyecto pedagógico no encontrado.');

  const [competency] = await trx('project_competencies')
    .insert({ tenant_id: tenantId, pedagogical_project_id: projectId, description })
    .returning('*');
  return competency;
}

// ---------- Actividades de evaluación (con la validación crítica del 100%) ----------

/**
 * Crea o actualiza una actividad de evaluación, validando que la sumatoria
 * de `weight_percent` de TODAS las actividades del plan (excluyendo la que
 * se está editando) más la nueva no supere 100.
 *
 * `forUpdate()` bloquea las filas de actividades del plan hasta que la
 * transacción de este request termine (commit/rollback lo hace
 * tenant.middleware al final del request), así que si dos docentes intentan
 * agregar actividades al mismo plan al mismo tiempo, la segunda espera a que
 * la primera transacción cierre antes de leer el total — evitando que ambas
 * lean "40% usado" y las dos agreguen 70% sin verse.
 *
 * Como red de seguridad adicional existe un CONSTRAINT TRIGGER en la base de
 * datos (migrations/001_init.sql) que rechaza el INSERT/UPDATE si, por
 * cualquier vía, la suma igual queda por encima de 100.
 */
/** El plan debe existir y estar ABIERTO para modificar sus actividades. Bloquea la fila del plan. */
async function getOpenPlan(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans as ep')
    .join('terms as t', 't.id', 'ep.term_id')
    .where({ 'ep.id': planId, 'ep.tenant_id': tenantId })
    .select('ep.*', 't.name as term_name', 't.start_date as term_start', 't.end_date as term_end')
    .forUpdate('ep')
    .first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
  if (plan.status === 'closed') {
    throw ApiError.conflict('El plan de evaluación está cerrado. Reábrelo para modificar sus actividades.');
  }
  return plan;
}

/** "Primer Lapso (del 2026-09-14 al 2026-12-18)" para mensajes de fecha fuera de rango. */
function termRange(plan) {
  if (plan.term_start && plan.term_end) return plan.term_name + ' (del ' + plan.term_start + ' al ' + plan.term_end + ')';
  if (plan.term_start) return plan.term_name + ' (desde el ' + plan.term_start + ')';
  if (plan.term_end) return plan.term_name + ' (hasta el ' + plan.term_end + ')';
  return plan.term_name;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Valida y normaliza la estructura detallada de una actividad:
 *  - criterios con al menos un indicador; indicadores con puntaje > 0;
 *  - la suma de puntajes de los indicadores = puntaje máximo de la actividad;
 *  - fechas de aplicación: una por sección DEL PLAN, dentro del lapso.
 */
function validateDetailed(plan, planSections, { maxScore, criteria, sectionDates }) {
  if (criteria.length) {
    if (plan.format !== 'detailed') {
      throw ApiError.unprocessable('Los criterios e indicadores son del formato detallado: cambia el formato del plan primero.', [
        { path: 'criteria', message: 'Plan en formato simple.' },
      ]);
    }
    criteria.forEach((c, i) => {
      if (!c.indicators.length) {
        throw ApiError.badRequest(`El criterio ${i + 1} ("${c.title}") necesita al menos un indicador.`, [
          { path: `criteria.${i}.indicators`, message: 'Agrega un indicador.' },
        ]);
      }
    });
    const total = round2(criteria.flatMap((c) => c.indicators).reduce((n, ind) => n + Number(ind.points), 0));
    if (total !== round2(maxScore)) {
      throw ApiError.unprocessable(
        `Los puntajes de los indicadores suman ${total} y deben sumar el puntaje de la actividad (${round2(maxScore)}).`,
        [{ path: 'criteria', message: `Suman ${total} de ${round2(maxScore)}.` }]
      );
    }
  }

  const allowed = new Map(planSections.map((s) => [s.id, s.name]));
  const seen = new Set();
  sectionDates.forEach((d) => {
    if (!allowed.has(d.sectionId)) {
      throw ApiError.badRequest('Hay una fecha de aplicación para una sección que no pertenece al plan.', [
        { path: 'sectionDates', message: 'Sección ajena al plan.' },
      ]);
    }
    if (seen.has(d.sectionId)) throw ApiError.badRequest(`La sección ${allowed.get(d.sectionId)} tiene dos fechas de aplicación.`);
    seen.add(d.sectionId);
    if ((plan.term_start && d.date < plan.term_start) || (plan.term_end && d.date > plan.term_end)) {
      throw ApiError.unprocessable(`La fecha de la sección ${allowed.get(d.sectionId)} debe estar dentro de ${termRange(plan)}.`, [
        { path: 'sectionDates', message: 'Fuera del lapso.' },
      ]);
    }
  });
}

/**
 * Guarda criterios e indicadores de una actividad comparando por id: se
 * actualizan los existentes, se crean los nuevos y se borran los que faltan.
 * Con notas registradas solo se permite cambiar textos: agregar, quitar o
 * cambiar el puntaje de un indicador cambiaría el significado de esas notas.
 */
async function saveCriteria(trx, tenantId, activityId, criteria, hasScores) {
  const oldCriteria = await trx('evaluation_criteria').where({ activity_id: activityId });
  const oldIndicators = await trx('evaluation_indicators').where({ activity_id: activityId });
  const incomingIndicators = criteria.flatMap((c) => c.indicators);

  if (hasScores) {
    const keptIds = new Set(incomingIndicators.filter((i) => i.id).map((i) => i.id));
    const changed =
      incomingIndicators.some((i) => !i.id) ||
      oldIndicators.some((o) => !keptIds.has(o.id)) ||
      incomingIndicators.some((i) => {
        const old = oldIndicators.find((o) => o.id === i.id);
        return old && round2(old.points) !== round2(i.points);
      });
    if (changed) {
      throw ApiError.conflict(
        'La actividad ya tiene notas: no se pueden agregar ni quitar indicadores, ni cambiar sus puntajes (sí corregir sus textos).',
        [{ path: 'criteria', message: 'Actividad con notas.' }]
      );
    }
  }

  // Ids enviados deben pertenecer a ESTA actividad (no a otra del colegio).
  const bad =
    criteria.some((c) => c.id && !oldCriteria.some((o) => o.id === c.id)) ||
    incomingIndicators.some((i) => i.id && !oldIndicators.some((o) => o.id === i.id));
  if (bad) throw ApiError.badRequest('Hay criterios o indicadores que no pertenecen a esta actividad.');

  // 1. Indicadores que ya no vienen (sin notas: lo garantiza la validación de arriba).
  const keepIndicatorIds = incomingIndicators.filter((i) => i.id).map((i) => i.id);
  await trx('evaluation_indicators').where({ activity_id: activityId }).whereNotIn('id', keepIndicatorIds).delete();

  // 2. Guardar criterios y mover cada indicador a su criterio (puede cambiar de grupo).
  // Los criterios viejos se borran AL FINAL, ya vacíos: borrarlos antes arrastraría en
  // cascada indicadores que se conservan (y que pueden tener notas).
  const usedCriteriaIds = [];
  for (const [ci, c] of criteria.entries()) {
    let criterionId = c.id;
    if (criterionId) {
      await trx('evaluation_criteria').where({ id: criterionId }).update({ title: c.title, position: ci + 1 });
    } else {
      [{ id: criterionId }] = await trx('evaluation_criteria')
        .insert({ tenant_id: tenantId, activity_id: activityId, position: ci + 1, title: c.title })
        .returning('id');
    }
    usedCriteriaIds.push(criterionId);
    for (const [ii, ind] of c.indicators.entries()) {
      const data = { criterion_id: criterionId, position: ii + 1, description: ind.description, points: ind.points };
      if (ind.id) await trx('evaluation_indicators').where({ id: ind.id }).update(data);
      else await trx('evaluation_indicators').insert({ ...data, tenant_id: tenantId, activity_id: activityId });
    }
  }

  // 3. Criterios que ya no se usan (ya sin indicadores).
  await trx('evaluation_criteria').where({ activity_id: activityId }).whereNotIn('id', usedCriteriaIds).delete();
}

/**
 * Crea o edita una actividad del plan. Campos comunes: título, tipo,
 * porcentaje, descripción, fecha estimada. Formato detallado además:
 * estrategia, referencias teórico-prácticas, puntaje máximo, criterios con
 * indicadores (puntos) y fecha de aplicación por sección. La suma de
 * porcentajes del plan nunca supera 100% (y para cerrarlo debe ser 100%).
 */
async function upsertActivity(
  trx,
  tenantId,
  planId,
  { activityId, title, category, weightPercent, description, plannedDate, strategy, contentRefs, maxScore, criteria, sectionDates }
) {
  if (weightPercent <= 0 || weightPercent > 100) {
    throw ApiError.badRequest('El porcentaje debe estar entre 0 (exclusivo) y 100.');
  }

  const plan = await getOpenPlan(trx, tenantId, planId);
  const planSections = await listPlanSections(trx, planId);

  // La fecha estimada debe caer dentro del lapso (si el lapso tiene fechas).
  if (plannedDate && ((plan.term_start && plannedDate < plan.term_start) || (plan.term_end && plannedDate > plan.term_end))) {
    throw ApiError.unprocessable('La fecha estimada debe estar dentro de ' + termRange(plan) + '.', [
      { path: 'plannedDate', message: 'Fuera del lapso.' },
    ]);
  }

  const activities = await trx('evaluation_activities')
    .where({ tenant_id: tenantId, evaluation_plan_id: planId })
    .forUpdate();

  const existing = activityId ? activities.find((a) => a.id === activityId) : null;
  if (activityId && !existing) throw ApiError.notFound('Actividad no encontrada en este plan.');
  const hasScores = existing ? Boolean(await trx('activity_scores').where({ evaluation_activity_id: activityId }).first()) : false;

  // Sin estructura enviada, se conserva la actual (editar solo título/porcentaje no borra indicadores).
  const effectiveMax = maxScore ?? (existing ? Number(existing.max_score) : 20);
  if (existing && hasScores && round2(effectiveMax) !== round2(existing.max_score)) {
    throw ApiError.conflict('La actividad ya tiene notas: no se puede cambiar su puntaje máximo.', [
      { path: 'maxScore', message: 'Actividad con notas.' },
    ]);
  }
  if (criteria !== undefined || sectionDates !== undefined || maxScore !== undefined) {
    validateDetailed(plan, planSections, {
      maxScore: effectiveMax,
      criteria: criteria ?? (existing ? (await loadActivityStructure(trx, [activityId])).get(activityId).criteria : []),
      sectionDates: sectionDates ?? [],
    });
  }

  const currentTotal = activities
    .filter((a) => a.id !== activityId)
    .reduce((sum, a) => sum + Number(a.weight_percent), 0);

  const newTotal = Math.round((currentTotal + Number(weightPercent)) * 100) / 100;

  if (newTotal > 100) {
    throw ApiError.unprocessable(
      `La suma de porcentajes excede 100%. Actual: ${currentTotal}%, intentando ${activityId ? 'actualizar a' : 'agregar'} ${weightPercent}% (total ${newTotal}%).`,
      { currentTotal, attempted: weightPercent, newTotal }
    );
  }

  const fields = {
    title,
    category,
    weight_percent: weightPercent,
    description: description ?? null,
    planned_date: plannedDate ?? null,
    ...(strategy !== undefined ? { strategy: strategy || null } : {}),
    ...(contentRefs !== undefined ? { content_refs: JSON.stringify(contentRefs) } : {}),
    max_score: effectiveMax,
  };

  let saved;
  if (existing) {
    [saved] = await trx('evaluation_activities').where({ id: activityId, tenant_id: tenantId }).update(fields).returning('*');
    // `activity_scores.weighted_score` guarda (nota / máximo) × porcentaje: si cambia
    // el porcentaje hay que recalcularlo, o el acumulado de los alumnos queda desfasado.
    await trx('activity_scores')
      .where({ tenant_id: tenantId, evaluation_activity_id: activityId })
      .update({ weighted_score: trx.raw('(raw_score / max_score) * ?', [weightPercent]) });
  } else {
    [saved] = await trx('evaluation_activities')
      .insert({ tenant_id: tenantId, evaluation_plan_id: planId, ...fields })
      .returning('*');
  }

  if (criteria !== undefined) await saveCriteria(trx, tenantId, saved.id, criteria, hasScores);
  if (sectionDates !== undefined) {
    await trx('activity_section_dates').where({ activity_id: saved.id }).delete();
    for (const d of sectionDates) {
      await trx('activity_section_dates').insert({ tenant_id: tenantId, activity_id: saved.id, section_id: d.sectionId, applied_on: d.date });
    }
  }

  const structure = await loadActivityStructure(trx, [saved.id]);
  return { ...saved, max_score: Number(saved.max_score), ...structure.get(saved.id) };
}

async function deleteActivity(trx, tenantId, planId, activityId) {
  await getOpenPlan(trx, tenantId, planId);
  // Debe pertenecer al plan de la URL (antes se podía borrar la actividad de otro plan).
  const activity = await trx('evaluation_activities')
    .where({ id: activityId, tenant_id: tenantId, evaluation_plan_id: planId })
    .first();
  if (!activity) throw ApiError.notFound('Actividad no encontrada en este plan.');

  const hasScores = await trx('activity_scores').where({ evaluation_activity_id: activityId }).first();
  if (hasScores) {
    throw ApiError.conflict('No se puede eliminar: ya hay calificaciones registradas para esta actividad.');
  }

  await trx('evaluation_activities').where({ id: activityId }).delete();
}

/**
 * Cierra el plan: solo si sus actividades suman EXACTAMENTE 100%. Cerrado, las
 * actividades quedan bloqueadas (las notas se siguen cargando con normalidad).
 */
async function closePlan(trx, tenantId, planId) {
  await getOpenPlan(trx, tenantId, planId);
  const { rows } = await trx.raw(
    'SELECT COALESCE(sum(weight_percent), 0)::numeric(6,2) AS total, count(*)::int AS n FROM evaluation_activities WHERE evaluation_plan_id = ?',
    [planId]
  );
  const total = Number(rows[0].total);
  if (rows[0].n === 0) throw ApiError.unprocessable('No se puede cerrar un plan sin actividades.');
  if (total !== 100) {
    const missing = Math.round((100 - total) * 100) / 100;
    throw ApiError.unprocessable(
      'No se puede cerrar: las actividades suman ' + total + '%. Faltan ' + missing + '% para llegar a 100%.',
      { total }
    );
  }
  await trx('evaluation_plans').where({ id: planId }).update({ status: 'closed', closed_at: trx.fn.now() });
  return getPlanWithActivities(trx, tenantId, planId);
}

async function reopenPlan(trx, tenantId, planId) {
  const plan = await trx('evaluation_plans').where({ id: planId, tenant_id: tenantId }).first();
  if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
  if (plan.status !== 'closed') throw ApiError.conflict('El plan ya está abierto.');
  await trx('evaluation_plans').where({ id: planId }).update({ status: 'open', closed_at: null });
  return getPlanWithActivities(trx, tenantId, planId);
}

module.exports = {
  updatePlan,
  listPlanSections,
  loadActivityStructure,
  closePlan,
  reopenPlan,
  listTerms,
  createTerm,
  listPlans,
  getPlanWithActivities,
  createPlan,
  createPedagogicalProject,
  addCompetency,
  upsertActivity,
  deleteActivity,
};
