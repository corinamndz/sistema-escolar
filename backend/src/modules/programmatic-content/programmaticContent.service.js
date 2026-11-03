const { ApiError } = require('../../utils/ApiError');
const { exclusionOf } = require('../academics/sectionSubjects');

/**
 * Contenido programático de una materia en un grado (migración 038): ítems con
 * Unidad, Tema y Descripción, y las actividades de evaluación vinculadas a cada
 * uno (evaluation_activities.programmatic_content_id).
 *
 * `pairs` (de teacherScope.teachingPairs) limita al docente a los grados y
 * materias que dicta; `scope` (getTeacherScope) filtra los planes y
 * actividades a los de su carga. Ambos null = sin restricción.
 */

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
/** "Unidad IV" → 4, "Unidad 2" → 2, "Introducción" → null (para ordenar las unidades). */
function unitNumber(unit) {
  const last = String(unit).trim().split(/\s+/).pop().toUpperCase();
  if (/^\d+$/.test(last)) return Number(last);
  if (!/^[IVXLC]+$/.test(last)) return null;
  let n = 0;
  for (let i = 0; i < last.length; i += 1) {
    const v = ROMAN[last[i]];
    n += v < (ROMAN[last[i + 1]] || 0) ? -v : v;
  }
  return n;
}

/** Orden de las unidades: numeradas por su número (I, II… o 1, 2…); el resto por nombre, al final. */
function compareUnits(a, b) {
  const na = unitNumber(a);
  const nb = unitNumber(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

const ymdKey = (d) => (d === null || d === undefined ? '9999-12-31' : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const timeKey = (d) => (d ? new Date(d).getTime() : 0);

/**
 * Ordena actividades de evaluación según el contenido programático (el orden
 * oficial del programa de la asignatura), igual que la pantalla de Contenido
 * programático:
 *   1. las vinculadas a un tema: por unidad (I, II, III… o 1, 2, 3…) y, dentro
 *      de la unidad, por el orden del tema (sort_order);
 *   2. dentro del mismo tema: por fecha estimada y luego por creación;
 *   3. al final, las que no tienen tema, por fecha estimada y creación.
 * Recibe filas con `programmatic_content_id`, `planned_date` y `created_at`
 * (nombres configurables) y devuelve un arreglo NUEVO ordenado.
 */
async function sortByProgram(trx, activities, { contentKey = 'programmatic_content_id', dateKey = 'planned_date', createdKey = 'created_at' } = {}) {
  const ids = [...new Set(activities.map((a) => a[contentKey]).filter(Boolean))];
  const topics = new Map(ids.length ? (await trx('programmatic_content').whereIn('id', ids).select('id', 'unit', 'sort_order')).map((t) => [t.id, t]) : []);
  return [...activities].sort((a, b) => {
    const ta = topics.get(a[contentKey]);
    const tb = topics.get(b[contentKey]);
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    if (ta && tb) {
      const unit = ta.unit === tb.unit ? 0 : compareUnits(ta.unit, tb.unit);
      if (unit) return unit;
      if (ta.sort_order !== tb.sort_order) return ta.sort_order - tb.sort_order;
    }
    return ymdKey(a[dateKey]).localeCompare(ymdKey(b[dateKey])) || timeKey(a[createdKey]) - timeKey(b[createdKey]);
  });
}

/**
 * Grado + materia del plan de estudios (grade_subjects, lo que se configura en
 * Materias); 404 si la materia no se dicta en ese grado. `requireActive`: para
 * crear temas la materia además debe estar activa.
 */
async function getPair(trx, tenantId, gradeId, subjectId, { requireActive = false } = {}) {
  const pair = await trx('grade_subjects as gs')
    .join('grades as g', 'g.id', 'gs.grade_id')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where({ 'gs.tenant_id': tenantId, 'gs.grade_id': gradeId, 'gs.subject_id': subjectId })
    .select('g.id as grade_id', 'g.name as grade_name', 'g.level_code', 'el.name as level_name', 's.id as subject_id', 's.name as subject_name', 's.is_active')
    .first();
  if (!pair) throw ApiError.notFound('La materia no se dicta en ese grado. Asígnala al grado en el módulo de Materias.');
  if (requireActive && !pair.is_active) throw ApiError.conflict(`La materia "${pair.subject_name}" está inactiva: actívala en Materias para agregarle temas.`);
  return pair;
}

/**
 * Año escolar del temario (068: cada tema es de un año). `forWriting`: en un
 * año finalizado no se agregan temas.
 */
async function getPeriod(trx, tenantId, schoolPeriodId, { forWriting = false } = {}) {
  const period = schoolPeriodId ? await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first() : null;
  if (!period) throw ApiError.notFound('Año escolar no encontrado.');
  if (forWriting && period.closed_at) throw ApiError.conflict(`El año escolar ${period.name} está finalizado: no se le pueden agregar temas.`);
  return period;
}

async function getItem(trx, tenantId, id) {
  const item = await trx('programmatic_content').where({ id, tenant_id: tenantId }).first();
  if (!item) throw ApiError.notFound('Contenido programático no encontrado.');
  return item;
}

/**
 * Pares grado–materia para los selectores de la pantalla, tomados del plan de
 * estudios (grade_subjects): cada grado ofrece solo las materias que tiene
 * asignadas en Materias. Docente: solo los que dicta. Las materias inactivas
 * se omiten salvo que ya tengan temas (para poder consultarlos).
 */
async function listOptions(trx, tenantId, { pairs, schoolPeriodId = null }) {
  const rows = await trx('grade_subjects as gs')
    .join('grades as g', 'g.id', 'gs.grade_id')
    .join('subjects as s', 's.id', 'gs.subject_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .where('gs.tenant_id', tenantId)
    .select(
      'g.id as grade_id',
      'g.name as grade_name',
      'g.level_code',
      's.id as subject_id',
      's.name as subject_name',
      's.is_active as subject_active',
      // Temas del año elegido (sin año: de todos).
      trx.raw(
        '(SELECT count(*)::int FROM programmatic_content pc WHERE pc.grade_id = gs.grade_id AND pc.subject_id = gs.subject_id AND (?::uuid IS NULL OR pc.school_period_id = ?::uuid)) AS content_count',
        [schoolPeriodId, schoolPeriodId]
      )
    )
    // Orden de la estructura del colegio (nivel → grado) y, dentro del grado, por materia.
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'g.name' }, { column: 's.name' }]);
  return rows.filter((r) => (r.subject_active || r.content_count > 0) && (!pairs || pairs.has(`${r.grade_id}|${r.subject_id}`)));
}

/**
 * Contenido programático de la materia en el grado DEL AÑO indicado (cada año
 * tiene su propio temario), con las actividades de evaluación de cada ítem en
 * los planes de ese año, más lo necesario para
 * "Incluir evaluación": los planes de la materia en ese grado y año (a los que
 * se agrega la actividad) y las secciones donde se puede crear uno nuevo.
 */
async function getContent(trx, tenantId, { gradeId, subjectId, schoolPeriodId }, { scope, coversPlan, coversSubject }) {
  const pair = await getPair(trx, tenantId, gradeId, subjectId);
  const period = await getPeriod(trx, tenantId, schoolPeriodId);

  const items = await trx('programmatic_content')
    .where({ tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId, school_period_id: period.id })
    .orderBy([{ column: 'sort_order' }, { column: 'created_at' }]);

  // Planes de la materia en el grado y año, con sus secciones y su total.
  const planRows = period
    ? await trx('evaluation_plans as ep')
        .join('terms as t', 't.id', 'ep.term_id')
        .join('sections as sec', 'sec.id', 'ep.section_id')
        .join('staff as st', 'st.id', 'ep.teacher_id')
        .where({ 'ep.tenant_id': tenantId, 'ep.subject_id': subjectId, 'sec.grade_id': gradeId, 't.school_period_id': period.id })
        .select(
          'ep.id',
          'ep.subject_id',
          'ep.status',
          'ep.format',
          't.term_number',
          't.name as term_name',
          trx.raw("st.first_name || ' ' || st.last_name AS teacher_name"),
          trx.raw('(SELECT COALESCE(sum(a.weight_percent), 0)::float FROM evaluation_activities a WHERE a.evaluation_plan_id = ep.id) AS total_weight'),
          trx.raw('(SELECT array_agg(x.section_id) FROM evaluation_plan_sections x WHERE x.plan_id = ep.id) AS section_ids'),
          trx.raw(
            "(SELECT string_agg(s2.name, ', ' ORDER BY s2.name) FROM evaluation_plan_sections x JOIN sections s2 ON s2.id = x.section_id WHERE x.plan_id = ep.id) AS section_names"
          )
        )
        .orderBy([{ column: 't.term_number' }, { column: 'section_names' }])
    : [];
  const plans = planRows.filter((p) => coversPlan(scope, p, p.section_ids || []));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const planSections = plans.length
    ? await trx('evaluation_plan_sections as x')
        .join('sections as s', 's.id', 'x.section_id')
        .whereIn('x.plan_id', plans.map((p) => p.id))
        .select('x.plan_id', 's.id', 's.name')
        .orderBy('s.name')
    : [];

  // Actividades de cada ítem: solo las de los planes visibles (del año y de la carga del docente).
  const activities = items.length && plans.length
    ? await trx('evaluation_activities as a')
        .whereIn('a.programmatic_content_id', items.map((i) => i.id))
        .whereIn('a.evaluation_plan_id', plans.map((p) => p.id))
        .select(
          'a.id',
          'a.programmatic_content_id',
          'a.evaluation_plan_id',
          'a.title',
          'a.category',
          'a.weight_percent',
          'a.planned_date',
          trx.raw('EXISTS (SELECT 1 FROM activity_scores sc WHERE sc.evaluation_activity_id = a.id) AS has_scores')
        )
        .orderByRaw('a.planned_date ASC NULLS LAST, a.created_at ASC')
    : [];

  // Secciones donde se puede crear un plan nuevo: del grado y año, con la materia, y de la carga del docente.
  const sections = period
    ? (
        await trx('sections as sec')
          .where({ 'sec.tenant_id': tenantId, 'sec.grade_id': gradeId, 'sec.school_period_id': period.id })
          .whereNotExists(exclusionOf(trx, trx.ref('sec.id'), subjectId))
          .select('sec.id', 'sec.name')
          .orderBy('sec.name')
      ).filter((s) => coversSubject(scope, s.id, subjectId))
    : [];

  const planSummary = (p) => ({
    id: p.id,
    status: p.status,
    format: p.format,
    term_number: p.term_number,
    term_name: p.term_name,
    section_names: p.section_names,
    sections: planSections.filter((s) => s.plan_id === p.id).map(({ id, name }) => ({ id, name })),
    teacher_name: p.teacher_name,
    total_weight: Math.round(Number(p.total_weight) * 100) / 100,
  });

  const units = [...new Set(items.map((i) => i.unit))].sort(compareUnits);
  return {
    ...pair,
    school_period: period ? { id: period.id, name: period.name, closed: Boolean(period.closed_at) } : null,
    units: units.map((unit) => ({
      unit,
      items: items
        .filter((i) => i.unit === unit)
        .map((i) => ({
          id: i.id,
          unit: i.unit,
          topic: i.topic,
          description: i.description,
          activities: activities
            .filter((a) => a.programmatic_content_id === i.id)
            .map(({ programmatic_content_id: _c, evaluation_plan_id: planId, ...a }) => ({
              ...a,
              weight_percent: Number(a.weight_percent),
              plan: planSummary(planById.get(planId)),
            })),
        })),
    })),
    plans: plans.map(planSummary),
    sections,
  };
}

async function createItem(trx, tenantId, { gradeId, subjectId, schoolPeriodId, unit, topic, description }) {
  await getPair(trx, tenantId, gradeId, subjectId, { requireActive: true });
  await getPeriod(trx, tenantId, schoolPeriodId, { forWriting: true });
  const where = { tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId, school_period_id: schoolPeriodId };
  const { max } = await trx('programmatic_content').where(where).max('sort_order as max').first();
  const [item] = await trx('programmatic_content')
    .insert({ ...where, unit, topic, description, sort_order: max === null ? 0 : Number(max) + 1 })
    .returning('*');
  return item;
}

async function updateItem(trx, tenantId, id, { unit, topic, description }) {
  await getItem(trx, tenantId, id);
  const payload = { unit, topic, description, updated_at: trx.fn.now() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const [item] = await trx('programmatic_content').where({ id }).update(payload).returning('*');
  return item;
}

/** Borra el ítem. Sus actividades NO se borran (pueden tener notas): quedan en su plan, sin contenido. */
async function deleteItem(trx, tenantId, id) {
  await getItem(trx, tenantId, id);
  const { n } = await trx('evaluation_activities').where({ programmatic_content_id: id }).count('* as n').first();
  await trx('programmatic_content').where({ id }).delete();
  return { unlinkedActivities: Number(n) };
}

/**
 * Duplica el temario de una materia en un grado de un año a otro (unidades y
 * temas, en el mismo orden). Los temas que ya existen en el destino (misma
 * unidad y tema) no se repiten: se puede repetir sin crear duplicados.
 * Las evaluaciones son de los planes (por sección y lapso) y se duplican desde
 * Planes de evaluación.
 */
async function duplicateContent(trx, tenantId, { gradeId, subjectId, fromPeriodId, toPeriodId }) {
  if (fromPeriodId === toPeriodId) throw ApiError.badRequest('Elige un año escolar de destino distinto al de origen.');
  const pair = await getPair(trx, tenantId, gradeId, subjectId, { requireActive: true });
  const from = await getPeriod(trx, tenantId, fromPeriodId);
  const to = await getPeriod(trx, tenantId, toPeriodId, { forWriting: true });
  const items = await copyTopics(trx, tenantId, { gradeId, subjectId, fromPeriodId: from.id, toPeriodId: to.id });
  return { ...items, subject_name: pair.subject_name, grade_name: pair.grade_name, from: from.name, to: to.name };
}

/**
 * Copia los temas (todos, o solo `onlyIds`) al año destino, saltando los que ya
 * están. Devuelve { copied, skipped, map } con map: id origen → id destino
 * (también para los que ya existían), para re-enlazar actividades duplicadas.
 */
async function copyTopics(trx, tenantId, { gradeId, subjectId, fromPeriodId, toPeriodId, onlyIds = null }) {
  const base = { tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId };
  const source = await trx('programmatic_content')
    .where({ ...base, school_period_id: fromPeriodId })
    .modify((q) => onlyIds && q.whereIn('id', onlyIds))
    .orderBy([{ column: 'sort_order' }, { column: 'created_at' }]);
  const existing = await trx('programmatic_content').where({ ...base, school_period_id: toPeriodId });
  const key = (i) => `${i.unit.trim().toLowerCase()}|${i.topic.trim().toLowerCase()}`;
  const byKey = new Map(existing.map((i) => [key(i), i.id]));
  let next = existing.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1;
  const map = new Map();
  let copied = 0;
  for (const item of source) {
    const found = byKey.get(key(item));
    if (found) {
      map.set(item.id, found);
      continue;
    }
    const [row] = await trx('programmatic_content')
      .insert({ ...base, school_period_id: toPeriodId, unit: item.unit, topic: item.topic, description: item.description, sort_order: next++ })
      .returning('id');
    byKey.set(key(item), row.id);
    map.set(item.id, row.id);
    copied += 1;
  }
  return { copied, skipped: source.length - copied, map };
}

/**
 * Valida el contenido de una actividad contra su plan (mensaje claro antes del
 * trigger de las migraciones 038/068): misma materia, mismo grado y mismo año.
 */
async function assertContentForPlan(trx, tenantId, contentId, plan) {
  const item = await trx('programmatic_content').where({ id: contentId, tenant_id: tenantId }).first();
  if (!item) throw ApiError.badRequest('El contenido programático no existe.', [{ path: 'programmaticContentId', message: 'Contenido inválido.' }]);
  const { grade_id: gradeId } = await trx('sections').where({ id: plan.section_id }).select('grade_id').first();
  if (item.subject_id !== plan.subject_id || item.grade_id !== gradeId) {
    throw ApiError.unprocessable('Ese contenido programático es de otra materia o de otro grado que el plan.', [
      { path: 'programmaticContentId', message: 'No corresponde al plan.' },
    ]);
  }
  const { school_period_id: periodId } = await trx('terms').where({ id: plan.term_id }).select('school_period_id').first();
  if (item.school_period_id !== periodId) {
    throw ApiError.unprocessable('Ese contenido programático es de otro año escolar que el plan.', [
      { path: 'programmaticContentId', message: 'Es de otro año escolar.' },
    ]);
  }
  return item;
}

module.exports = {
  listOptions,
  getPair,
  getPeriod,
  getContent,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  duplicateContent,
  copyTopics,
  assertContentForPlan,
  compareUnits,
  unitNumber,
  sortByProgram,
};
