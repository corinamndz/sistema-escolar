const { z } = require('zod');
const f = require('../fields');
const { ApiError } = require('../../../utils/ApiError');
const gradingService = require('../../grading/grading.service');

/** Descripción corta para encabezados de columna. */
const short = (text, n = 40) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/**
 * Calificaciones de UN plan de evaluación. La plantilla sale precargada con
 * los alumnos inscritos en las secciones del plan y las notas actuales:
 *
 * - Actividad simple: una columna con la nota (0 a su puntaje máximo).
 * - Actividad con indicadores (formato detallado): una columna por indicador
 *   (0 a su puntaje); la nota de la actividad es la suma. En cada fila hay que
 *   completar TODOS los indicadores de la actividad, o ninguno.
 * - La columna oculta "ID interno" identifica al alumno aunque se reordenen
 *   las filas; si falta, se busca por cédula.
 * - Una celda vacía no borra ni cambia nada; las notas iguales a las
 *   guardadas se omiten.
 * - Si la estructura del plan cambió después de descargar, los encabezados ya
 *   no coinciden y se pide una plantilla nueva.
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
      .select('ep.*', 'g.name as grade_name')
      .first();
    if (!plan) throw ApiError.notFound('Plan de evaluación no encontrado.');
    if (plan.status === 'closed') {
      throw ApiError.conflict('El plan de evaluación está cerrado: reábrelo para cargar calificaciones.');
    }

    const activities = await trx('evaluation_activities').where({ tenant_id: tenantId, evaluation_plan_id: plan.id }).orderBy('created_at');
    if (activities.length === 0) throw ApiError.unprocessable('El plan no tiene actividades: agrégalas antes de cargar notas.');
    const indicators = await trx('evaluation_indicators as i')
      .join('evaluation_criteria as c', 'c.id', 'i.criterion_id')
      .whereIn('i.activity_id', activities.map((a) => a.id))
      .select('i.*', 'c.position as criterion_position')
      .orderBy(['c.position', 'i.position']);

    const sections = await trx('evaluation_plan_sections as x')
      .join('sections as s', 's.id', 'x.section_id')
      .where('x.plan_id', plan.id)
      .select('s.id', 's.name')
      .orderBy('s.name');
    const multiSection = sections.length > 1;

    const students = await trx('enrollments as e')
      .join('students as s', 's.id', 'e.student_id')
      .join('evaluation_plan_sections as x', 'x.section_id', 'e.section_id')
      .join('sections as sec', 'sec.id', 'e.section_id')
      .where({ 'e.tenant_id': tenantId, 'x.plan_id': plan.id, 'e.status': 'active' })
      .select('s.id', 's.first_name', 's.last_name', 's.national_id', 'sec.name as section_name')
      .orderBy(['sec.name', 's.last_name', 's.first_name']);

    const activityIds = activities.map((a) => a.id);
    const scores = await trx('activity_scores').whereIn('evaluation_activity_id', activityIds);
    const indScores = await trx('indicator_scores').whereIn('activity_id', activityIds);
    const existing = new Map(scores.map((s) => [`${s.evaluation_activity_id}|${s.student_id}`, Number(s.raw_score)]));
    const existingInd = new Map(indScores.map((s) => [`${s.indicator_id}|${s.student_id}`, Number(s.points)]));

    // Columnas: una por actividad simple, una por indicador en las detalladas.
    const groups = activities.map((a, i) => {
      const inds = indicators.filter((ind) => ind.activity_id === a.id);
      const max = Number(a.max_score);
      if (inds.length === 0) {
        return {
          activity: a,
          cols: [
            {
              key: `act_${i}`,
              // El número evita ambigüedad si dos actividades tienen el mismo título.
              header: `${i + 1}. ${a.title} (${Number(a.weight_percent)}%)`,
              mustExist: true,
              width: Math.min(34, Math.max(14, a.title.length + 10)),
              note: `Nota de 0 a ${max} (admite decimales). Vacío = sin cambios. Peso: ${Number(a.weight_percent)}% del lapso.`,
              max,
            },
          ],
        };
      }
      return {
        activity: a,
        indicators: inds,
        cols: inds.map((ind) => {
          const code = `${ind.criterion_position}.${ind.position}`;
          return {
            key: `act_${i}_${ind.id}`,
            indicator: ind,
            header: `${i + 1}. ${a.title} › ${code} ${short(ind.description)} (${Number(ind.points)} pts)`,
            mustExist: true,
            width: 22,
            note: `${a.title} · indicador ${code}: ${ind.description}. Nota de 0 a ${Number(ind.points)}. Completa todos los indicadores de la actividad o ninguno.`,
            max: Number(ind.points),
          };
        }),
      };
    });
    const activityColumns = groups.flatMap((g) => g.cols);

    const columns = [
      { key: 'studentId', header: 'ID interno', note: 'No modificar: identifica al alumno.' },
      { key: 'nationalId', header: 'Cédula', text: true, note: 'Informativa (se usa si falta el ID interno).' },
      { key: 'studentName', header: 'Alumno', width: 32, note: 'Informativo: no se modifica desde aquí.' },
      // Solo en planes de varias secciones.
      ...(multiSection ? [{ key: 'section', header: 'Sección', text: true, width: 10, note: 'Informativa.' }] : []),
      ...activityColumns,
    ];

    const sectionsText = sections.map((s) => s.name).join('-');
    return {
      plan,
      groups,
      existing,
      existingInd,
      studentsById: new Map(students.map((s) => [s.id, s])),
      studentsByKey: new Map(students.filter((s) => s.national_id).map((s) => [f.idKey(s.national_id), s])),
      columns,
      template: {
        title: `Calificaciones — ${plan.subject} · ${plan.grade_name} ${sections.map((s) => s.name).join(', ')}`,
        fileName: `calificaciones-${plan.subject}-${plan.grade_name}-${sectionsText}.xlsx`
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^\w.-]+/g, '-')
          .toLowerCase(),
        hiddenKeys: ['studentId'],
        instructions: [
          'Escribe la nota de cada alumno. En las actividades por indicadores, anota lo obtenido en cada indicador: la nota de la actividad es la suma.',
          'Deja la celda vacía para no cambiar esa nota. En una actividad por indicadores, completa todos sus indicadores o ninguno.',
          'No agregues alumnos ni actividades en el archivo: se toman del plan. Si cambias la estructura del plan, descarga una plantilla nueva.',
        ],
        prefill: students.map((s) => ({
          studentId: s.id,
          nationalId: s.national_id || '',
          studentName: `${s.last_name}, ${s.first_name}`,
          ...(multiSection ? { section: s.section_name } : {}),
          ...Object.fromEntries(
            activityColumns.map((c) => [
              c.key,
              c.indicator ? existingInd.get(`${c.indicator.id}|${s.id}`) ?? null : existing.get(`${groups.find((g) => g.cols.includes(c)).activity.id}|${s.id}`) ?? null,
            ])
          ),
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
        message: 'El alumno no está inscrito en ninguna sección de este plan (o se modificó su ID/cédula).',
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
    for (const g of ctx.groups) {
      if (!g.indicators) {
        // Actividad simple: una nota.
        const col = g.cols[0];
        const r = f.score(v[col.key], { label: g.activity.title, max: col.max });
        if (r.error) errors.push({ column: col.key, reason: 'nota inválida', message: r.error });
        else if (r.value !== null && ctx.existing.get(`${g.activity.id}|${student.id}`) !== r.value) {
          changes.push({ activityId: g.activity.id, rawScore: r.value });
        }
        continue;
      }
      // Actividad por indicadores: todos o ninguno.
      const values = g.cols.map((col) => ({ col, r: f.score(v[col.key], { label: `${g.activity.title} › ${col.indicator.description}`, max: col.max }) }));
      const bad = values.filter((x) => x.r.error);
      bad.forEach((x) => errors.push({ column: x.col.key, reason: 'nota inválida', message: x.r.error }));
      if (bad.length) continue;
      const filled = values.filter((x) => x.r.value !== null);
      if (filled.length === 0) continue;
      if (filled.length < values.length) {
        errors.push({
          column: values.find((x) => x.r.value === null).col.key,
          reason: 'indicadores incompletos',
          message: `${g.activity.title}: completa los ${values.length} indicadores (faltan ${values.length - filled.length}) o deja todos vacíos.`,
        });
        continue;
      }
      const differs = values.some((x) => ctx.existingInd.get(`${x.col.indicator.id}|${student.id}`) !== x.r.value);
      if (differs) {
        changes.push({
          activityId: g.activity.id,
          indicatorScores: values.map((x) => ({ indicatorId: x.col.indicator.id, points: x.r.value })),
        });
      }
    }

    // Sin notas nuevas ni cambiadas: no hay nada que guardar en esta fila.
    return { data: { studentId: student.id, changes }, errors, label, skip: errors.length === 0 && changes.length === 0 };
  },

  async insert(trx, tenantId, data) {
    for (const c of data.changes) {
      // upsertScore vuelve a validar inscripción y rangos, y recalcula el ponderado.
      await gradingService.upsertScore(trx, tenantId, { studentId: data.studentId, ...c });
    }
    return { notes: [`${data.changes.length} nota${data.changes.length === 1 ? '' : 's'}`], count: data.changes.length };
  },
};
