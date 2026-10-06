const { ApiError } = require('../../utils/ApiError');

/**
 * Calificaciones acumuladas de un alumno para el portal del representante.
 *
 * Modelo (ya existente): evaluation_plans (sección + lapso + materia + docente)
 *   → evaluation_activities (título, % de la nota)
 *     → activity_scores (nota obtenida `raw_score` sobre `max_score`)
 *
 * Por cada plan (una materia en un lapso) se calcula:
 *   earned_percent   Σ (nota / máximo) × % actividad   → puntos ganados de 100
 *   evaluated_weight Σ % de las actividades ya calificadas
 *   accumulated      earned_percent / 100 × ESCALA      → "llevas X de 20"
 *   current_average  earned_percent / evaluated_weight × ESCALA → rendimiento en lo evaluado
 *   final_grade      = accumulated, solo cuando ya se evaluó el 100% del plan
 *
 * La ponderación se calcula aquí a partir de la nota y del % ACTUAL de la
 * actividad (no del `weighted_score` guardado), así el resultado es correcto
 * aunque el porcentaje se haya editado después de cargar notas.
 */

const GRADE_SCALE = 20; // escala de calificación del colegio (coincide con activity_scores.max_score por defecto)
const PASSING_GRADE = 10; // nota mínima aprobatoria sobre GRADE_SCALE

const round2 = (n) => Math.round(n * 100) / 100;

/** El alumno debe estar vinculado al representante del usuario; si no, 404 (no se revela su existencia). */
async function assertGuardianOfStudent(trx, tenantId, userId, studentId) {
  const link = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .join('students as s', 's.id', 'sg.student_id')
    .where({ 'g.tenant_id': tenantId, 'g.user_id': userId, 'sg.student_id': studentId })
    .select('s.id', 's.first_name', 's.last_name', 's.national_id', 's.status', 'sg.relationship')
    .first();
  if (!link) throw ApiError.notFound('Alumno no encontrado.');
  return link;
}

/** Mensaje para la familia cuando las calificaciones están bloqueadas por deuda. */
const GRADES_LOCKED_MESSAGE =
  'Acceso a detalles del alumno bloqueado por pagos pendientes. Por favor, comuníquese con administración o reporte su pago.';

/**
 * Cuotas VENCIDAS del alumno: pendientes, con la fecha de vencimiento pasada
 * y que la familia no haya reportado como pagadas (un pago reportado queda en
 * revisión y no bloquea). Misma regla que el estado "vencido" de los pagos.
 */
async function overdueCount(trx, tenantId, studentId) {
  const row = await trx('payments')
    .where({ tenant_id: tenantId, student_id: studentId, status: 'pending' })
    .whereNull('reported_at')
    .whereNotNull('due_date')
    .andWhere('due_date', '<', trx.raw('current_date'))
    .andWhere((q) => q.whereNull('issue_date').orWhere('issue_date', '<=', trx.raw('current_date')))
    .count('id as n')
    .first();
  return Number(row.n);
}

/**
 * Portal del representante: con cuotas vencidas, las calificaciones del
 * alumno (y su historial académico, que también muestra notas) quedan
 * bloqueadas → 403 con un mensaje para la familia.
 */
async function assertGradesUnlocked(trx, tenantId, studentId) {
  const overdue = await overdueCount(trx, tenantId, studentId);
  if (overdue > 0) {
    throw ApiError.forbidden(GRADES_LOCKED_MESSAGE, [{ path: 'payments', message: `GRADES_LOCKED: ${overdue} cuota(s) vencida(s)` }]);
  }
}

function summarizePlan(activities) {
  const graded = activities.filter((a) => a.raw_score !== null);
  const totalWeight = activities.reduce((n, a) => n + a.weight_percent, 0);
  const evaluatedWeight = graded.reduce((n, a) => n + a.weight_percent, 0);
  const earnedPercent = graded.reduce((n, a) => n + a.earned_percent, 0);
  const complete = activities.length > 0 && round2(totalWeight) === 100 && round2(evaluatedWeight) === 100;

  let status = 'in_progress';
  if (activities.length === 0) status = 'no_activities';
  else if (graded.length === 0) status = 'no_grades';
  else if (complete) status = 'final';

  const accumulated = round2((earnedPercent / 100) * GRADE_SCALE);
  return {
    status,
    total_weight: round2(totalWeight),
    evaluated_weight: round2(evaluatedWeight),
    earned_percent: round2(earnedPercent),
    accumulated,
    current_average: evaluatedWeight > 0 ? round2((earnedPercent / evaluatedWeight) * GRADE_SCALE) : null,
    final_grade: complete ? accumulated : null,
    graded_count: graded.length,
    activity_count: activities.length,
  };
}

async function getStudentGrades(trx, tenantId, userId, studentId, { schoolPeriodId } = {}) {
  const student = await assertGuardianOfStudent(trx, tenantId, userId, studentId);

  // Años escolares en los que el alumno tuvo inscripción (activa o no), el más reciente primero.
  const periods = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId })
    .distinct('sp.id', 'sp.name', 'sp.start_date', 'sp.is_active', 'sp.passing_grade')
    .orderByRaw('sp.is_active DESC, sp.start_date DESC NULLS LAST');

  const base = { student, scale: GRADE_SCALE, passing_grade: PASSING_GRADE, periods, school_period: null, terms: [], subjects: [] };
  if (periods.length === 0) return base;

  const period = schoolPeriodId ? periods.find((p) => p.id === schoolPeriodId) : periods[0];
  if (!period) throw ApiError.notFound('El alumno no tiene inscripciones en ese año escolar.');

  const sections = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'sec.school_period_id': period.id })
    .select('sec.id', 'sec.name', 'g.name as grade_name', 'g.level_code', 'e.status as enrollment_status');

  // Planes de las secciones del alumno, incluidos los compartidos entre varias
  // secciones (migración 012). Si un alumno pasó por dos secciones del mismo
  // plan, el plan aparece una sola vez (con su sección vigente).
  const planRows = sections.length
    ? await trx('evaluation_plans as ep')
        .join('evaluation_plan_sections as eps', 'eps.plan_id', 'ep.id')
        .join('terms as t', 't.id', 'ep.term_id')
        .join('staff as st', 'st.id', 'ep.teacher_id')
        .leftJoin('subjects as sub', 'sub.id', 'ep.subject_id')
        .where('ep.tenant_id', tenantId)
        .whereIn('eps.section_id', sections.map((s) => s.id))
        .select(
          'ep.id',
          'eps.section_id',
          'ep.subject',
          'ep.subject_id',
          'sub.code as subject_code',
          't.id as term_id',
          't.name as term_name',
          't.start_date as term_start',
          trx.raw("st.first_name || ' ' || st.last_name AS teacher_name")
        )
        .orderByRaw('t.term_number NULLS LAST, t.start_date NULLS LAST, t.name, ep.subject')
    : [];
  const isActiveSection = (id) => sections.some((sec) => sec.id === id && sec.enrollment_status === 'active');
  const plans = [];
  planRows.forEach((row) => {
    const i = plans.findIndex((p) => p.id === row.id);
    if (i < 0) plans.push(row);
    else if (!isActiveSection(plans[i].section_id) && isActiveSection(row.section_id)) plans[i] = row;
  });
  const planIds = plans.map((p) => p.id);

  const activities = planIds.length
    ? await trx('evaluation_activities as a')
        .leftJoin('activity_scores as sc', function joinScore() {
          this.on('sc.evaluation_activity_id', 'a.id').andOn('sc.student_id', trx.raw('?', [studentId]));
        })
        .whereIn('a.evaluation_plan_id', planIds)
        .select(
          'a.id',
          'a.evaluation_plan_id',
          'a.title',
          'a.category',
          'a.weight_percent',
          'sc.raw_score',
          'sc.max_score',
          'sc.graded_at'
        )
        .orderBy('a.created_at')
    : [];

  // Proyecto pedagógico y competencias (evaluación cualitativa), si el plan lo tiene.
  const competencies = planIds.length
    ? await trx('pedagogical_projects as pp')
        .join('project_competencies as pc', 'pc.pedagogical_project_id', 'pp.id')
        .leftJoin('competency_assessments as ca', function joinAssessment() {
          this.on('ca.project_competency_id', 'pc.id').andOn('ca.student_id', trx.raw('?', [studentId]));
        })
        .whereIn('pp.evaluation_plan_id', planIds)
        .select('pp.evaluation_plan_id', 'pp.title as project_title', 'pc.id', 'pc.description', 'ca.result')
    : [];

  const planViews = plans.map((plan) => {
    const acts = activities
      .filter((a) => a.evaluation_plan_id === plan.id)
      .map((a) => {
        const weight = Number(a.weight_percent);
        const graded = a.raw_score !== null;
        const raw = graded ? Number(a.raw_score) : null;
        const max = graded ? Number(a.max_score) : null;
        return {
          id: a.id,
          title: a.title,
          category: a.category,
          weight_percent: weight,
          raw_score: raw,
          max_score: max,
          // Nota llevada a la escala del colegio (ej. 85/100 → 17/20) para comparar actividades.
          scaled_score: graded ? round2((raw / max) * GRADE_SCALE) : null,
          earned_percent: graded ? (raw / max) * weight : 0,
          graded_at: a.graded_at,
        };
      });
    const planCompetencies = competencies.filter((c) => c.evaluation_plan_id === plan.id);
    const section = sections.find((s) => s.id === plan.section_id);
    return {
      plan_id: plan.id,
      term_id: plan.term_id,
      term_name: plan.term_name,
      teacher_name: plan.teacher_name,
      section: `${section.grade_name} ${section.name}`,
      section_withdrawn: section.enrollment_status !== 'active',
      ...summarizePlan(acts),
      activities: acts.map(({ earned_percent: earned, ...a }) => ({ ...a, earned_percent: round2(earned) })),
      project: planCompetencies.length
        ? {
            title: planCompetencies[0].project_title,
            competencies: planCompetencies.map((c) => ({ id: c.id, description: c.description, result: c.result })),
          }
        : null,
      _subjectKey: plan.subject_id || plan.subject.trim().toLowerCase(),
      _subject: plan.subject,
      _subjectCode: plan.subject_code,
    };
  });

  // Agrupar por materia: por subject_id si el plan es de una materia del plan de estudios
  // (Primaria y Secundaria); si no, por el nombre del área (Inicial).
  const subjects = [];
  planViews.forEach(({ _subjectKey: key, _subject: name, _subjectCode: code, ...plan }) => {
    let subject = subjects.find((s) => s.key === key);
    if (!subject) {
      subject = { key, name, code, plans: [] };
      subjects.push(subject);
    }
    subject.plans.push(plan);
  });
  subjects.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const terms = [...new Map(plans.map((p) => [p.term_id, { id: p.term_id, name: p.term_name }])).values()];

  // Nota mínima: la de la normativa del año escolar consultado (migración 014).
  const passingGrade = period.passing_grade === undefined || period.passing_grade === null ? PASSING_GRADE : Number(period.passing_grade);
  return { ...base, passing_grade: passingGrade, school_period: { id: period.id, name: period.name }, sections, terms, subjects };
}

module.exports = {
  assertGuardianOfStudent, assertGradesUnlocked, overdueCount, GRADES_LOCKED_MESSAGE, getStudentGrades, GRADE_SCALE, PASSING_GRADE };
