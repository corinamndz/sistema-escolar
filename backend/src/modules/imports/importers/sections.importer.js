const f = require('../fields');
const { normalizeHeader } = require('../excel');
const academicService = require('../../academics/academic.service');
const assignmentService = require('../../academics/assignment.service');

const fullName = (s) => `${s.first_name} ${s.last_name}`;
/** Texto de la lista desplegable de docentes: "Rosa Pérez · V-12345678". */
const teacherOption = (s) => (s.national_id ? `${fullName(s)} · ${s.national_id}` : fullName(s));

/**
 * Secciones (Paso 4), con aula y docentes opcionales. Todo lo referenciado
 * (grado, año escolar, aula, docentes) debe existir antes: se busca por
 * nombre o cédula y se informa fila por fila lo que no se encuentre.
 *
 * Docentes según el nivel del grado:
 *   Inicial     → docente guía (titular) + auxiliar opcional
 *   Primaria    → docente guía (titular); sin auxiliar
 *   Secundaria  → no aplica: los profesores se asignan por materia
 */
module.exports = {
  type: 'sections',
  label: 'Secciones',
  noun: { one: 'sección', many: 'secciones' },
  permission: ['academics', 'create'],
  fileName: 'plantilla-secciones.xlsx',

  async prepare(trx, tenantId, params, actor = {}) {
    const grades = await trx('grades as g')
      .join('education_levels as el', 'el.code', 'g.level_code')
      .where('g.tenant_id', tenantId)
      .select('g.id', 'g.name', 'g.level_code', 'el.name as level_name', 'el.assignment_mode', 'el.allows_assistant')
      .orderBy(['el.sort_order', 'g.sort_order', 'g.name']);
    const periods = await trx('school_periods').where({ tenant_id: tenantId }).orderBy('start_date', 'desc');
    const classrooms = await trx('classrooms').where({ tenant_id: tenantId }).orderBy('name');
    const staff = await trx('staff').where({ tenant_id: tenantId }).select('id', 'first_name', 'last_name', 'national_id', 'staff_type', 'status');
    const existing = await trx('sections').where({ tenant_id: tenantId }).select('grade_id', 'school_period_id', 'name');

    const group = (rows, keyFn) => {
      const map = new Map();
      rows.forEach((r) => map.set(keyFn(r), [...(map.get(keyFn(r)) || []), r]));
      return map;
    };
    const teachers = staff.filter((s) => s.staff_type === 'teaching' && s.status === 'active');
    const activePeriods = periods.filter((p) => p.is_active);
    // Asignar docentes exige además permiso de edición (igual que la pantalla de asignación).
    const canAssign = Boolean(actor.permissions?.academics?.can_update);

    return {
      canAssign,
      gradesByName: group(grades, (g) => normalizeHeader(g.name)),
      periodsByName: group(periods, (p) => normalizeHeader(p.name)),
      defaultPeriod: activePeriods.length === 1 ? activePeriods[0] : null,
      activePeriods,
      classroomsByName: group(classrooms, (c) => normalizeHeader(c.name)),
      staffById: group(staff.filter((s) => s.national_id), (s) => f.idKey(s.national_id)),
      staffByName: group(staff, (s) => normalizeHeader(fullName(s))),
      existingKeys: new Set(existing.map((s) => `${s.grade_id}|${s.school_period_id}|${normalizeHeader(s.name)}`)),
      columns: [
        { key: 'grade', header: 'Grado', required: true, options: grades.map((g) => g.name), width: 18, note: 'Grado ya registrado (Paso 2). Elige de la lista.' },
        { key: 'name', header: 'Nombre de la sección', required: true, text: true, width: 22, note: 'Ej.: "A", "B", "Única". Máx. 20 caracteres. No puede repetirse en el mismo grado y año.' },
        {
          key: 'period',
          header: 'Año escolar',
          options: periods.map((p) => p.name),
          width: 16,
          note:
            activePeriods.length === 1
              ? `Opcional: si lo dejas vacío se usa el año activo (${activePeriods[0].name}).`
              : 'Año escolar ya registrado (Paso 1). Obligatorio porque hay más de un año activo o ninguno.',
        },
        { key: 'maxStudents', header: 'Cupo máximo', note: 'Opcional. Número de alumnos (por defecto 30).' },
        { key: 'classroom', header: 'Aula', options: classrooms.length ? classrooms.map((c) => c.name) : undefined, width: 18, note: 'Opcional. Aula ya registrada (Paso 2), por nombre.' },
        {
          key: 'leadTeacher',
          header: 'Docente guía',
          options: teachers.length ? teachers.map(teacherOption) : undefined,
          width: 30,
          note: 'Opcional, solo Inicial y Primaria (en Secundaria los profesores se asignan por materia). Elige de la lista o escribe la cédula del docente.',
        },
        {
          key: 'assistantTeacher',
          header: 'Docente auxiliar',
          options: teachers.length ? teachers.map(teacherOption) : undefined,
          width: 30,
          note: 'Opcional, solo Inicial. Debe ser distinto del docente guía.',
        },
      ],
      template: {
        title: 'Plantilla de carga masiva de secciones',
        instructions: [
          'Antes de importar secciones deben existir los grados, el año escolar y (si los indicas) las aulas y el personal docente.',
          'Asignar docentes desde el archivo requiere permiso de edición en Estructura académica.',
        ],
        examples: [
          { grade: grades[0]?.name || '3er grado', name: 'A', period: activePeriods[0]?.name || '2026-2027', maxStudents: 30, classroom: classrooms[0]?.name || 'Aula 1A', leadTeacher: teachers[0] ? teacherOption(teachers[0]) : 'V-12345678', assistantTeacher: '' },
          { grade: grades[0]?.name || '3er grado', name: 'B', period: '', maxStudents: 28, classroom: '', leadTeacher: '', assistantTeacher: '' },
        ],
      },
    };
  },

  /** Docente por opción de la lista ("Nombre · cédula"), por cédula o por nombre completo. */
  resolveTeacher(value, ctx, column, label, errors) {
    const raw = String(value).trim();
    const idPart = raw.includes('·') ? raw.slice(raw.lastIndexOf('·') + 1).trim() : raw;
    let found = ctx.staffById.get(f.idKey(idPart)) || [];
    if (!found.length) found = ctx.staffByName.get(normalizeHeader(raw.split('·')[0])) || [];

    if (found.length === 0) {
      errors.push({ column, reason: 'docente no registrado', message: `${label}: no se encontró "${raw}" en Personal.` });
    } else if (found.length > 1) {
      errors.push({ column, reason: 'docente ambiguo', message: `${label}: hay ${found.length} personas que coinciden con "${raw}"; usa la cédula.` });
    } else if (found[0].staff_type !== 'teaching') {
      errors.push({ column, reason: 'personal no docente', message: `${label}: ${fullName(found[0])} no es personal docente.` });
    } else if (found[0].status !== 'active') {
      errors.push({ column, reason: 'docente inactivo', message: `${label}: ${fullName(found[0])} está inactivo.` });
    } else {
      return found[0];
    }
    return null;
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      grade: [f.text, v.grade, { max: 60, required: true, label: 'El grado' }],
      name: [f.text, v.name, { max: 20, required: true, label: 'El nombre de la sección' }],
      period: [f.text, v.period, { max: 30, label: 'El año escolar' }],
      maxStudents: [f.integer, v.maxStudents, { min: 1, max: 200, label: 'El cupo máximo' }],
      classroom: [f.text, v.classroom, { max: 60, label: 'El aula' }],
      leadTeacher: [f.text, v.leadTeacher, { max: 200, label: 'El docente guía' }],
      assistantTeacher: [f.text, v.assistantTeacher, { max: 200, label: 'El docente auxiliar' }],
    });

    // ---- Grado ----
    let grade = null;
    if (data.grade) {
      const found = ctx.gradesByName.get(normalizeHeader(data.grade)) || [];
      if (found.length === 1) [grade] = found;
      else errors.push({ column: 'grade', reason: 'grado inexistente', message: `No existe el grado "${data.grade}". Créalo primero en el Paso 2.` });
    }

    // ---- Año escolar (vacío → el único activo) ----
    let period = null;
    if (data.period) {
      const found = ctx.periodsByName.get(normalizeHeader(data.period)) || [];
      if (found.length === 1) [period] = found;
      else errors.push({ column: 'period', reason: 'año inexistente', message: `No existe el año escolar "${data.period}".` });
    } else if (ctx.defaultPeriod) {
      period = ctx.defaultPeriod;
    } else {
      errors.push({
        column: 'period',
        reason: 'falta el año escolar',
        message: ctx.activePeriods.length ? 'Hay más de un año escolar activo: indica cuál.' : 'No hay un año escolar activo: indica el año o créalo en el Paso 1.',
      });
    }

    // ---- Aula ----
    if (data.classroom) {
      const found = ctx.classroomsByName.get(normalizeHeader(data.classroom)) || [];
      if (found.length === 1) data.classroomId = found[0].id;
      else if (found.length > 1) errors.push({ column: 'classroom', reason: 'aula ambigua', message: `Hay ${found.length} aulas llamadas "${data.classroom}".` });
      else errors.push({ column: 'classroom', reason: 'aula inexistente', message: `No existe el aula "${data.classroom}". Créala primero en el Paso 2.` });
    }

    // ---- Duplicados (grado + año + nombre) ----
    if (grade && period && data.name) {
      const key = `${grade.id}|${period.id}|${normalizeHeader(data.name)}`;
      state.keys ||= new Map();
      const where = `${grade.name} ${data.name} (${period.name})`;
      if (ctx.existingKeys.has(key)) errors.push({ column: 'name', reason: 'sección duplicada', message: `Ya existe la sección ${where}.` });
      else if (state.keys.has(key)) errors.push({ column: 'name', reason: 'sección duplicada', message: `Sección repetida en la fila ${state.keys.get(key)}.` });
      else state.keys.set(key, state.row);
    }

    // ---- Docentes, según el nivel del grado ----
    if (data.leadTeacher || data.assistantTeacher) {
      if (!ctx.canAssign) {
        errors.push({ column: 'leadTeacher', reason: 'sin permiso para asignar docentes', message: 'No tienes permiso para asignar docentes: deja vacías las columnas de docentes.' });
      } else if (grade && grade.assignment_mode === 'subjects') {
        errors.push({
          column: data.leadTeacher ? 'leadTeacher' : 'assistantTeacher',
          reason: 'docente no permitido en el nivel',
          message: `En ${grade.level_name} no hay docente guía: los profesores se asignan por materia desde la sección.`,
        });
      } else if (grade) {
        if (data.assistantTeacher && !grade.allows_assistant) {
          errors.push({ column: 'assistantTeacher', reason: 'docente no permitido en el nivel', message: `En ${grade.level_name} cada sección tiene un único docente, sin auxiliar.` });
        }
        if (data.assistantTeacher && !data.leadTeacher) {
          errors.push({ column: 'leadTeacher', message: 'Indica el docente guía si asignas un auxiliar.' });
        }
        const lead = data.leadTeacher && this.resolveTeacher(data.leadTeacher, ctx, 'leadTeacher', 'Docente guía', errors);
        const assistant = data.assistantTeacher && grade.allows_assistant && this.resolveTeacher(data.assistantTeacher, ctx, 'assistantTeacher', 'Docente auxiliar', errors);
        if (lead && assistant && lead.id === assistant.id) {
          errors.push({ column: 'assistantTeacher', message: 'El auxiliar debe ser distinto del docente guía.' });
        }
        data.leadTeacherId = lead?.id || null;
        data.assistantTeacherId = assistant?.id || null;
      }
    }

    data.gradeId = grade?.id;
    data.schoolPeriodId = period?.id;
    const label = grade && data.name ? `${grade.name} ${data.name}${period ? ` · ${period.name}` : ''}` : data.name || null;
    return { data, errors, label };
  },

  async insert(trx, tenantId, data) {
    const section = await academicService.createSection(trx, tenantId, {
      gradeId: data.gradeId,
      schoolPeriodId: data.schoolPeriodId,
      classroomId: data.classroomId || null,
      name: data.name,
      maxStudents: data.maxStudents ?? 30,
    });
    const notes = [];
    if (data.leadTeacherId) {
      // Misma regla que la pantalla de asignación (nivel, docente activo, titular ≠ auxiliar).
      await assignmentService.setSectionAssignments(trx, tenantId, section.id, {
        leadTeacherId: data.leadTeacherId,
        assistantTeacherId: data.assistantTeacherId || null,
      });
      notes.push(data.assistantTeacherId ? 'Docente guía y auxiliar asignados' : 'Docente guía asignado');
    }
    return { id: section.id, notes };
  },
};
