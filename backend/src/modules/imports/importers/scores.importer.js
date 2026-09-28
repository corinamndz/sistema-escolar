const { z } = require('zod');
const f = require('../fields');
const { ApiError } = require('../../../utils/ApiError');
const gradingService = require('../../grading/grading.service');

const MAX_SCORE = 20;

/**
 * Calificaciones de UN plan de evaluación. La plantilla sale precargada con
 * los alumnos inscritos en la sección y una columna por actividad (con las
 * notas actuales), así el docente solo completa números.
 *
 * - La columna oculta "ID interno" identifica al alumno aunque se reordenen
 *   las filas; si falta, se busca por cédula.
 * - Una celda vacía no borra ni cambia nada; las notas iguales a las
 *   guardadas se omiten.
 * - Si las actividades del plan cambiaron después de descargar, los
 *   encabezados ya no coinciden y se pide una plantilla nueva.
 */
module.exports = {
  type: 'scores',
  label: 'Calificaciones',
  noun: { one: 'alumno', many: 'alumnos' },
  permission: ['grading', 'update'],
  fileName: 'plantilla-calificaciones.xlsx',

  async prepare(trx, tenantId, params) {
    const planId = z.string().uuid({ message: 'Indica el plan de evaluación.' }).safeParse(params.planId);
    if (!planId.success) throw ApiError.badRequest('Indica un plan de evaluación válido (planId).');

    const plan = await trx('evaluation_plans as ep')
      .join('sections as sec', 'sec.id', 'ep.section_id')
      .join('grades as g', 'g.id', 'sec.grade_id')
      .where({ 'ep.id': planId.data, 'ep.tenant_id': tenantId })
      .select('ep.*', 'sec.name as section_name', 'g.name as grade_name')
      .first();
    if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
    if (plan.status === 'closed') {
      throw ApiError.conflict('El plan de evaluación está cerrado: reábrelo para cargar calificaciones.');
    }

    const activities = await trx('evaluation_activities').where({ tenant_id: tenantId, evaluation_plan_id: plan.id }).orderBy('created_at');
    if (activities.length === 0) throw ApiError.unprocessable('El plan no tiene actividades: agrégalas antes de cargar notas.');

    const students = await trx('enrollments as e')
      .join('students as s', 's.id', 'e.student_id')
      .where({ 'e.tenant_id': tenantId, 'e.section_id': plan.section_id, 'e.status': 'active' })
      .select('s.id', 's.first_name', 's.last_name', 's.national_id')
      .orderBy(['s.last_name', 's.first_name']);

    const scores = await trx('activity_scores').whereIn('evaluation_activity_id', activities.map((a) => a.id));
    const existing = new Map(scores.map((s) => [`${s.evaluation_activity_id}|${s.student_id}`, Number(s.raw_score)]));

    const activityCols = activities.map((a, i) => ({
      key: `act_${i}`,
      activity: a,
      // El número evita ambigüedad si dos actividades tienen el mismo título.
      header: `${i + 1}. ${a.title} (${Number(a.weight_percent)}%)`,
      mustExist: true,
      width: Math.min(34, Math.max(14, a.title.length + 10)),
      note: `Nota de 0 a ${MAX_SCORE} (admite decimales). Vacío = sin cambios. Peso: ${Number(a.weight_percent)}% del lapso.`,
    }));

    const columns = [
      { key: 'studentId', header: 'ID interno', note: 'No modificar: identifica al alumno.' },
      { key: 'nationalId', header: 'Cédula', text: true, note: 'Informativa (se usa si falta el ID interno).' },
      { key: 'studentName', header: 'Alumno', width: 32, note: 'Informativo: no se modifica desde aquí.' },
      ...activityCols,
    ];

    return {
      plan,
      activityCols,
      existing,
      studentsById: new Map(students.map((s) => [s.id, s])),
      studentsByKey: new Map(students.filter((s) => s.national_id).map((s) => [f.idKey(s.national_id), s])),
      columns,
      template: {
        title: `Calificaciones — ${plan.subject} · ${plan.grade_name} ${plan.section_name}`,
        fileName: `calificaciones-${plan.subject}-${plan.grade_name}-${plan.section_name}.xlsx`
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^\w.-]+/g, '-')
          .toLowerCase(),
        hiddenKeys: ['studentId'],
        instructions: [
          `Escribe la nota de cada alumno en cada actividad, de 0 a ${MAX_SCORE}. Deja la celda vacía para no cambiar esa nota.`,
          'No agregues alumnos ni actividades en el archivo: se toman del plan. Si cambias las actividades del plan, descarga una plantilla nueva.',
        ],
        prefill: students.map((s) => ({
          studentId: s.id,
          nationalId: s.national_id || '',
          studentName: `${s.last_name}, ${s.first_name}`,
          ...Object.fromEntries(activityCols.map((c) => [c.key, existing.get(`${c.activity.id}|${s.id}`) ?? null])),
        })),
      },
    };
  },

  validate(v, ctx, state) {
    const errors = [];
    const student =
      (v.studentId && ctx.studentsById.get(String(v.studentId))) ||
      (v.nationalId && ctx.studentsByKey.get(f.idKey(String(v.nationalId)))) ||
      null;
    const label = student ? `${student.first_name} ${student.last_name}` : v.studentName ? String(v.studentName) : null;

    if (!student) {
      errors.push({
        column: 'studentName',
        reason: 'alumno no inscrito',
        message: 'El alumno no está inscrito en la sección de este plan (o se modificó su ID/cédula).',
      });
      return { data: {}, errors, label };
    }

    state.students ||= new Map();
    if (state.students.has(student.id)) {
      errors.push({ column: 'studentName', reason: 'alumno repetido', message: `El alumno ya aparece en la fila ${state.students.get(student.id)}.` });
    } else {
      state.students.set(student.id, state.row);
    }

    const changes = [];
    for (const col of ctx.activityCols) {
      const r = f.score(v[col.key], { label: col.activity.title, max: MAX_SCORE });
      if (r.error) errors.push({ column: col.key, reason: 'nota inválida', message: r.error });
      else if (r.value !== null && ctx.existing.get(`${col.activity.id}|${student.id}`) !== r.value) {
        changes.push({ activityId: col.activity.id, rawScore: r.value });
      }
    }

    // Sin notas nuevas ni cambiadas: no hay nada que guardar en esta fila.
    return { data: { studentId: student.id, changes }, errors, label, skip: errors.length === 0 && changes.length === 0 };
  },

  async insert(trx, tenantId, data) {
    for (const c of data.changes) {
      // upsertScore vuelve a validar inscripción y rango, y recalcula el ponderado.
      await gradingService.upsertScore(trx, tenantId, { activityId: c.activityId, studentId: data.studentId, rawScore: c.rawScore, maxScore: MAX_SCORE });
    }
    return { notes: [`${data.changes.length} nota${data.changes.length === 1 ? '' : 's'}`], count: data.changes.length };
  },
};
