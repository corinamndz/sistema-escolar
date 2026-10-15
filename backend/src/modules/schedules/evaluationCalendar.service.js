const { ApiError } = require('../../utils/ApiError');

/**
 * Horario de EVALUACIONES de una sección, generado automáticamente (no se
 * carga a mano) a partir de:
 *
 *   1. Los planes de evaluación que aplican a la sección (también los
 *      compartidos entre varias secciones), del lapso pedido.
 *   2. La fecha de cada actividad: la fecha propia de la sección
 *      (activity_section_dates, planes compartidos/detallados) o, si no
 *      tiene, la fecha estimada de la actividad (planned_date).
 *   3. La HORA: se toma del horario de clases. Una evaluación de Matemática
 *      el martes 14 va en el/los bloque(s) en que la sección tiene Matemática
 *      los martes. Si ese día no hay clase de la materia, queda "sin bloque"
 *      (y se avisa), sin inventar una hora.
 *
 * Además resume la CARGA por día para no amontonar evaluaciones pesadas
 * (examen, proyecto o ≥ 20 % del lapso): un día con 2 o más pesadas, o con 3
 * o más evaluaciones en total, se marca como sobrecargado.
 */

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const CATEGORY_LABELS = { formative: 'Formativa', exam: 'Examen', project: 'Proyecto', homework: 'Tarea', other: 'Otra' };
const HEAVY_WEIGHT = 20;
const isHeavy = (e) => e.category === 'exam' || e.category === 'project' || Number(e.weight_percent) >= HEAVY_WEIGHT;

const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null);
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
/** Día de la semana (1 = lunes … 7 = domingo) de una fecha 'YYYY-MM-DD', sin corrimientos de zona horaria. */
const isoDay = (date) => {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

async function getEvaluationCalendar(trx, tenantId, { sectionId, termNumber = null }) {
  const section = await trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'sec.id': sectionId, 'sec.tenant_id': tenantId })
    .select('sec.id', 'sec.name', 'sec.grade_id', 'sec.school_period_id', 'g.name as grade_name', 'g.grading_scale', 'sp.name as school_period_name')
    .first();
  if (!section) throw ApiError.notFound('Sección no encontrada.');

  const terms = (
    await trx('terms')
      .where({ tenant_id: tenantId, school_period_id: section.school_period_id })
      .orderByRaw('term_number NULLS LAST, start_date NULLS LAST')
      .select('id', 'name', 'term_number', 'start_date', 'end_date')
  ).map((t) => ({ ...t, start_date: ymd(t.start_date), end_date: ymd(t.end_date) }));
  const term = termNumber ? terms.find((t) => Number(t.term_number) === Number(termNumber)) : null;
  if (termNumber && !term) throw ApiError.notFound('Ese lapso no existe en el año escolar de la sección.');

  // Actividades de los planes que aplican a la sección (del lapso, si se pidió).
  const rows = await trx('evaluation_activities as a')
    .join('evaluation_plans as ep', 'ep.id', 'a.evaluation_plan_id')
    .join('evaluation_plan_sections as eps', function onSection() {
      this.on('eps.plan_id', 'ep.id').andOn('eps.section_id', trx.raw('?', [sectionId]));
    })
    .join('terms as t', 't.id', 'ep.term_id')
    .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
    .leftJoin('staff as st', 'st.id', 'ep.teacher_id')
    .leftJoin('activity_section_dates as asd', function onDate() {
      this.on('asd.activity_id', 'a.id').andOn('asd.section_id', trx.raw('?', [sectionId]));
    })
    .where('a.tenant_id', tenantId)
    .modify((q) => term && q.andWhere('ep.term_id', term.id))
    .select(
      'a.id as activity_id',
      'a.title',
      'a.category',
      'a.weight_percent',
      'a.planned_date',
      'a.description',
      'a.strategy',
      'a.content_refs',
      'a.max_score',
      'asd.applied_on',
      'ep.id as plan_id',
      'ep.status as plan_status',
      'ep.format as plan_format',
      'ep.subject_id',
      trx.raw('COALESCE(sub.name, ep.subject) AS subject_name'),
      'sub.code as subject_code',
      't.term_number',
      't.name as term_name',
      trx.raw("NULLIF(concat_ws(' ', st.first_name, st.last_name), '') AS teacher_name")
    );

  // Bloques del año y clases de la sección (para ubicar la hora de cada evaluación).
  const slots = (
    await trx('time_slots').where({ tenant_id: tenantId, school_period_id: section.school_period_id }).orderBy('start_time')
  ).map((s) => ({ id: s.id, name: s.name, start_time: hhmm(s.start_time), end_time: hhmm(s.end_time), is_break: s.is_break }));
  const classes = await trx('class_schedules').where({ tenant_id: tenantId, section_id: sectionId }).select('subject_id', 'day_of_week', 'time_slot_id');
  const slotById = new Map(slots.map((s) => [s.id, s]));

  // Estado de calificación en ESTA sección: alumnos inscritos (activos) y
  // cuántos ya tienen nota en cada actividad.
  const studentCount = Number((await trx('enrollments').where({ tenant_id: tenantId, section_id: sectionId, status: 'active' }).count('* as n').first()).n);
  const gradedRows = rows.length
    ? await trx('activity_scores as sc')
        .join('enrollments as e', function onEnrollment() {
          this.on('e.student_id', 'sc.student_id').andOn('e.section_id', trx.raw('?', [sectionId])).andOn('e.status', trx.raw('?', ['active']));
        })
        .whereIn('sc.evaluation_activity_id', rows.map((r) => r.activity_id))
        .groupBy('sc.evaluation_activity_id')
        .select('sc.evaluation_activity_id', trx.raw('COUNT(DISTINCT sc.student_id)::int AS n'))
    : [];
  const gradedOf = new Map(gradedRows.map((g) => [g.evaluation_activity_id, Number(g.n)]));
  const today = ymd(new Date());
  /**
   * Estado: graded (todos calificados) · in_progress (calificación parcial) ·
   * pending (ya pasó la fecha y nadie tiene nota) · scheduled (por venir) ·
   * unscheduled (sin fecha).
   */
  const statusOf = (date, graded) => {
    if (studentCount > 0 && graded >= studentCount) return 'graded';
    if (graded > 0) return 'in_progress';
    if (!date) return 'unscheduled';
    return date < today ? 'pending' : 'scheduled';
  };

  const evaluations = [];
  const undated = [];
  for (const r of rows) {
    const date = ymd(r.applied_on) || ymd(r.planned_date);
    const graded = gradedOf.get(r.activity_id) || 0;
    const base = {
      activity_id: r.activity_id,
      plan_id: r.plan_id,
      plan_status: r.plan_status,
      title: r.title,
      category: r.category,
      category_label: CATEGORY_LABELS[r.category] || r.category,
      weight_percent: Number(r.weight_percent),
      heavy: isHeavy(r),
      subject_id: r.subject_id,
      subject_name: r.subject_name,
      subject_code: r.subject_code,
      teacher_name: r.teacher_name,
      term_number: r.term_number,
      term_name: r.term_name,
      // Detalle para el modal de la evaluación.
      description: r.description,
      plan_format: r.plan_format,
      strategy: r.strategy,
      content_refs: Array.isArray(r.content_refs) ? r.content_refs : [],
      max_score: Number(r.max_score),
      graded_count: graded,
      student_count: studentCount,
      status: statusOf(date, graded),
    };
    if (!date) {
      undated.push(base);
      continue;
    }
    const day = isoDay(date);
    // Bloque(s) del horario en que la sección tiene esa materia ese día.
    const blocks = r.subject_id
      ? classes
          .filter((c) => c.subject_id === r.subject_id && Number(c.day_of_week) === day)
          .map((c) => slotById.get(c.time_slot_id))
          .filter(Boolean)
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
      : [];
    evaluations.push({
      ...base,
      date,
      date_source: r.applied_on ? 'section' : 'plan',
      day_of_week: day,
      day_name: DAY_NAMES[day % 7],
      weekend: day > 5,
      // El primer bloque del día ubica la evaluación en la grilla; todos para mostrar el horario.
      time_slot_id: blocks[0]?.id || null,
      start_time: blocks[0]?.start_time || null,
      end_time: blocks.length ? blocks[blocks.length - 1].end_time : null,
      blocks: blocks.map((b) => ({ id: b.id, name: b.name, start_time: b.start_time, end_time: b.end_time })),
    });
  }
  evaluations.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '99').localeCompare(b.start_time || '99') || a.subject_name.localeCompare(b.subject_name, 'es'));
  undated.sort((a, b) => a.subject_name.localeCompare(b.subject_name, 'es') || a.title.localeCompare(b.title, 'es'));

  // Carga por día.
  const byDate = new Map();
  evaluations.forEach((e) => {
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, day_name: e.day_name, total: 0, heavy: 0 });
    const d = byDate.get(e.date);
    d.total += 1;
    if (e.heavy) d.heavy += 1;
  });
  const days = [...byDate.values()].map((d) => ({ ...d, overloaded: d.heavy >= 2 || d.total >= 3 }));

  return {
    section,
    school_period: { id: section.school_period_id, name: section.school_period_name },
    terms,
    term: term || null,
    slots,
    evaluations,
    undated,
    days,
    summary: {
      total: evaluations.length + undated.length,
      scheduled: evaluations.length,
      undated: undated.length,
      heavy: evaluations.filter((e) => e.heavy).length,
      overloaded_days: days.filter((d) => d.overloaded).map((d) => d.date),
      without_block: evaluations.filter((e) => !e.time_slot_id && e.subject_id).length,
      // Rango a mostrar: el del lapso; si no tiene fechas, el de las evaluaciones.
      from: term?.start_date || evaluations[0]?.date || null,
      to: term?.end_date || evaluations[evaluations.length - 1]?.date || null,
    },
    rules: { heavy_weight: HEAVY_WEIGHT, heavy_categories: ['exam', 'project'], overloaded: { heavy: 2, total: 3 } },
  };
}

/**
 * Cronograma de evaluaciones para el PORTAL DEL REPRESENTANTE: el de la
 * sección en que cursa el alumno (inscripción activa, año en curso primero).
 * Se adapta a la familia:
 *   - sin estadísticas de la sección (cuántos compañeros tienen nota);
 *   - el estado es el del ALUMNO: "calificada" si él ya tiene nota en esa
 *     actividad (sin mostrar la nota: eso vive en Calificaciones).
 * El controlador valida antes que el alumno sea representado del usuario.
 */
async function getStudentEvaluationCalendar(trx, tenantId, studentId, { termNumber = null } = {}) {
  const enrollment = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .orderByRaw('sp.is_active DESC, sp.start_date DESC NULLS LAST')
    .select('e.section_id')
    .first();
  if (!enrollment) return { section: null, terms: [], term: null, slots: [], evaluations: [], undated: [], days: [], summary: null, audience: 'guardian' };

  const cal = await getEvaluationCalendar(trx, tenantId, { sectionId: enrollment.section_id, termNumber });
  const ids = [...cal.evaluations, ...cal.undated].map((e) => e.activity_id);
  const mine = new Set(
    ids.length ? await trx('activity_scores').where({ student_id: studentId }).whereIn('evaluation_activity_id', ids).pluck('evaluation_activity_id') : []
  );
  const today = ymd(new Date());
  const forStudent = (e) => {
    const graded = mine.has(e.activity_id);
    const status = graded ? 'graded' : !e.date ? 'unscheduled' : e.date < today ? 'pending' : 'scheduled';
    const { graded_count: _g, student_count: _s, ...rest } = e;
    return { ...rest, status, student_graded: graded };
  };
  return { ...cal, evaluations: cal.evaluations.map(forStudent), undated: cal.undated.map(forStudent), audience: 'guardian' };
}

module.exports = { getEvaluationCalendar, getStudentEvaluationCalendar, isHeavy, CATEGORY_LABELS };
