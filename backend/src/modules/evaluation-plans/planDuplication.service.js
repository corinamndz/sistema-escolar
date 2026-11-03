const { ApiError } = require('../../utils/ApiError');
const planService = require('./evaluationPlan.service');
const contentService = require('../programmatic-content/programmaticContent.service');
const { nearestWeekday } = require('../../utils/weekdays');

/**
 * "Duplicar para otro año": copia un plan de evaluación al mismo grado,
 * secciones (por nombre) y lapso (por número) de otro año escolar, con toda su
 * estructura: actividades, criterios e indicadores, fechas por sección y el
 * proyecto pedagógico. Las notas NO se copian.
 *
 *   - El plan nuevo se crea con createPlan: aplica las reglas del año destino
 *     (materia en el plan de estudios, docente asignado allí, sin plan repetido).
 *     Por eso el docente del plan nuevo es el que dicta la materia ESE año.
 *   - Los temas que evalúan sus actividades se buscan en el temario del año
 *     destino (misma unidad y tema); los que falten se copian allí (068).
 *   - Las fechas se corren la misma distancia que hay entre el inicio del
 *     lapso de origen y el de destino (sin fechas de lapso: un año); si caen
 *     en sábado o domingo pasan al día hábil más cercano del lapso.
 *   - Nace abierto y en borrador de revisión.
 * Corre en la transacción del request: o se copia todo o nada.
 */

const DAY = 86400000;
const toDate = (d) => (d ? new Date(`${String(d instanceof Date ? d.toISOString() : d).slice(0, 10)}T00:00:00Z`) : null);
const ymd = (d) => d.toISOString().slice(0, 10);

/** Desplaza una fecha `days` días (o un año si no hay referencia). */
function shiftDate(value, days) {
  const d = toDate(value);
  if (!d) return null;
  if (days === null) {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return ymd(d);
  }
  return ymd(new Date(d.getTime() + days * DAY));
}

/** Docente para planes de área libre (Inicial): el mismo si sigue en la sección; si no, el titular. */
async function freeAreaTeacher(trx, sourceTeacherId, sectionId) {
  const homeroom = await trx('teacher_sections').where({ section_id: sectionId }).select('staff_id', 'role');
  if (homeroom.some((h) => h.staff_id === sourceTeacherId)) return sourceTeacherId;
  return homeroom.find((h) => h.role === 'lead')?.staff_id || homeroom[0]?.staff_id;
}

/**
 * `assertCanCreate(input)`: la verificación de carga docente del controlador
 * (el docente solo duplica hacia secciones y materias suyas en el destino).
 */
async function duplicatePlan(trx, tenantId, planId, { toPeriodId }, { assertCanCreate = async () => {} } = {}) {
  const plan = await planService.getPlanWithActivities(trx, tenantId, planId);
  if (toPeriodId === plan.school_period_id) throw ApiError.badRequest('Elige un año escolar de destino distinto al del plan.');
  const target = await contentService.getPeriod(trx, tenantId, toPeriodId, { forWriting: true });

  // Secciones del mismo grado con el mismo nombre en el año destino.
  const targetSections = await trx('sections')
    .where({ tenant_id: tenantId, grade_id: plan.grade_id, school_period_id: target.id })
    .select('id', 'name');
  const sectionMap = new Map();
  const missing = [];
  for (const s of plan.sections) {
    const match = targetSections.find((t) => t.name.trim().toLowerCase() === s.name.trim().toLowerCase());
    if (match) sectionMap.set(s.id, match.id);
    else missing.push(s.name);
  }
  if (!sectionMap.size) {
    throw ApiError.unprocessable(
      `En ${target.name} no existe ${plan.sections.length === 1 ? 'la sección' : 'ninguna de las secciones'} ${plan.sections.map((s) => s.name).join(', ')} de ${plan.grade_name}. Créala en Grados y secciones (o con la transición de año) antes de duplicar.`
    );
  }

  const sectionIds = [...sectionMap.values()];
  const createInput = {
    sectionIds,
    termNumber: plan.term_number || undefined,
    format: plan.format,
    subjectId: plan.subject_id || undefined,
    subject: plan.subject,
    teacherId: plan.subject_id ? undefined : await freeAreaTeacher(trx, plan.teacher_id, sectionIds[0]),
  };
  if (!createInput.termNumber) throw ApiError.unprocessable('El lapso del plan no tiene número (I, II o III): no se puede ubicar su equivalente en el otro año.');
  await assertCanCreate(createInput);
  const created = await planService.createPlan(trx, tenantId, createInput);

  // Distancia entre lapsos para correr las fechas.
  const targetTerm = await trx('terms').where({ id: created.term_id }).first();
  const from = toDate(plan.term_start);
  const to = toDate(targetTerm.start_date);
  const offsetDays = from && to ? Math.round((to - from) / DAY) : null;
  // Corrida la fecha, si cae en sábado o domingo pasa al día hábil más cercano dentro del lapso destino.
  const termBounds = { min: targetTerm.start_date, max: targetTerm.end_date };
  const moveDate = (d) => nearestWeekday(shiftDate(d, offsetDays), termBounds);

  // Temas del año destino para las actividades (los que falten se copian).
  const usedContent = [...new Set(plan.activities.map((a) => a.programmatic_content_id).filter(Boolean))];
  const topics = usedContent.length
    ? await contentService.copyTopics(trx, tenantId, {
        gradeId: plan.grade_id,
        subjectId: plan.subject_id,
        fromPeriodId: plan.school_period_id,
        toPeriodId: target.id,
        onlyIds: usedContent,
      })
    : { copied: 0, map: new Map() };

  const activityMap = new Map();
  for (const a of plan.activities) {
    const [row] = await trx('evaluation_activities')
      .insert({
        tenant_id: tenantId,
        evaluation_plan_id: created.id,
        title: a.title,
        category: a.category,
        weight_percent: a.weight_percent,
        description: a.description,
        planned_date: moveDate(a.planned_date),
        strategy: a.strategy,
        // jsonb (arreglo): igual que upsertActivity, se envía serializado.
        content_refs: JSON.stringify(a.content_refs || []),
        max_score: a.max_score,
        instrument: a.instrument,
        programmatic_content_id: a.programmatic_content_id ? topics.map.get(a.programmatic_content_id) || null : null,
      })
      .returning('id');
    activityMap.set(a.id, row.id);

    for (const c of a.criteria || []) {
      const [criterion] = await trx('evaluation_criteria')
        .insert({ tenant_id: tenantId, activity_id: row.id, position: c.position, title: c.title })
        .returning('id');
      for (const i of c.indicators) {
        await trx('evaluation_indicators').insert({
          tenant_id: tenantId,
          criterion_id: criterion.id,
          activity_id: row.id,
          position: i.position,
          description: i.description,
          points: i.points,
        });
      }
    }
    for (const d of a.section_dates || []) {
      const sectionId = sectionMap.get(d.section_id);
      if (sectionId && d.applied_on) {
        await trx('activity_section_dates').insert({ tenant_id: tenantId, activity_id: row.id, section_id: sectionId, applied_on: moveDate(d.applied_on) });
      }
    }
  }

  const project = plan.pedagogicalProject;
  if (project) {
    const [copy] = await trx('pedagogical_projects')
      .insert({
        tenant_id: tenantId,
        evaluation_plan_id: created.id,
        title: project.title,
        description: project.description,
        evaluation_activity_id: project.evaluation_activity_id ? activityMap.get(project.evaluation_activity_id) || null : null,
      })
      .returning('id');
    for (const c of project.competencies || []) {
      await trx('project_competencies').insert({ tenant_id: tenantId, pedagogical_project_id: copy.id, description: c.description });
    }
  }

  const teacher = await trx('staff').where({ id: created.teacher_id }).first('first_name', 'last_name');
  return {
    plan_id: created.id,
    period: target.name,
    term_name: targetTerm.name,
    sections: targetSections.filter((s) => sectionIds.includes(s.id)).map((s) => s.name),
    missing_sections: missing,
    teacher_name: teacher ? `${teacher.first_name} ${teacher.last_name}` : null,
    activities: plan.activities.length,
    topics_created: topics.copied,
  };
}

module.exports = { duplicatePlan, shiftDate };
