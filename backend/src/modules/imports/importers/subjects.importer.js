const f = require('../fields');
const { normalizeHeader } = require('../excel');
const assignmentService = require('../../academics/assignment.service');

/**
 * Catálogo de materias y, opcionalmente, en qué grados (Primaria o Secundaria) se dictan
 * (se agregan al final del plan de estudios de cada grado indicado).
 *
 * Las materias no pertenecen a un nivel: el "nivel" lo da el grado. Por eso la
 * columna es "Grados" y no "Nivel", y admite grados de Primaria y Secundaria
 * (Inicial no tiene plan de estudios por materias).
 */
module.exports = {
  type: 'subjects',
  label: 'Materias',
  noun: { one: 'materia', many: 'materias' },
  permission: ['academics', 'create'],
  fileName: 'plantilla-materias.xlsx',

  async prepare(trx, tenantId) {
    const existing = await trx('subjects').where({ tenant_id: tenantId }).select(trx.raw('lower(name) AS name'), trx.raw('lower(code) AS code'));
    const grades = await trx('grades as g')
      .join('education_levels as el', 'el.code', 'g.level_code')
      .where('g.tenant_id', tenantId)
      .select('g.id', 'g.name', 'el.name as level_name', 'el.has_curriculum')
      .orderBy(['el.sort_order', 'g.sort_order', 'g.name']);
    // Primaria y Secundaria (niveles con plan de estudios, migrations/009).
    const withCurriculum = grades.filter((g) => g.has_curriculum);

    return {
      existingNames: new Set(existing.map((r) => r.name)),
      existingCodes: new Set(existing.map((r) => r.code).filter(Boolean)),
      gradesByName: new Map(grades.map((g) => [normalizeHeader(g.name), g])),
      columns: [
        { key: 'name', header: 'Nombre', required: true, width: 28, note: 'Nombre de la materia. No puede repetirse (sin importar mayúsculas).' },
        { key: 'code', header: 'Abreviatura', text: true, note: 'Opcional. Ej.: MAT. Máx. 20 caracteres, no puede repetirse.', aliases: ['Código'] },
        { key: 'description', header: 'Descripción', width: 40, note: 'Opcional. Máx. 500 caracteres.' },
        {
          key: 'grades',
          header: 'Grados (plan de estudios)',
          width: 34,
          aliases: ['Grados'],
          note: `Opcional. Grados de Primaria o Secundaria que ven la materia, separados por coma. ${
            withCurriculum.length ? `Disponibles: ${withCurriculum.map((g) => g.name).join(', ')}.` : 'Aún no hay grados de Primaria ni Secundaria.'
          }`,
        },
      ],
      template: {
        title: 'Plantilla de carga masiva de materias',
        instructions: [
          'Si completas "Grados", la materia se agrega al final del plan de estudios de esos grados. Si lo dejas vacío, puedes armar los planes después (Paso 3).',
        ],
        examples: [
          { name: 'Matemática', code: 'MAT', description: 'Aritmética, álgebra y geometría', grades: withCurriculum.slice(0, 2).map((g) => g.name).join(', ') || '1er año, 2do año' },
          { name: 'Castellano', code: 'CAS', description: '', grades: '' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      name: [f.text, v.name, { max: 100, required: true, label: 'El nombre' }],
      code: [f.text, v.code, { max: 20, label: 'La abreviatura' }],
      description: [f.text, v.description, { max: 500, label: 'La descripción' }],
      grades: [f.text, v.grades, { max: 1000, label: 'Los grados' }],
    });
    if (data.code) data.code = data.code.toUpperCase();

    state.names ||= new Map();
    state.codes ||= new Map();
    const name = data.name?.toLowerCase();
    const code = data.code?.toLowerCase();
    if (name) {
      if (ctx.existingNames.has(name)) errors.push({ column: 'name', reason: 'materia duplicada', message: `Ya existe la materia "${data.name}".` });
      else if (state.names.has(name)) errors.push({ column: 'name', reason: 'materia duplicada', message: `Materia repetida en la fila ${state.names.get(name)}.` });
      else state.names.set(name, state.row);
    }
    if (code) {
      if (ctx.existingCodes.has(code)) errors.push({ column: 'code', reason: 'abreviatura duplicada', message: `Ya existe una materia con la abreviatura ${data.code}.` });
      else if (state.codes.has(code)) errors.push({ column: 'code', reason: 'abreviatura duplicada', message: `Abreviatura repetida en la fila ${state.codes.get(code)}.` });
      else state.codes.set(code, state.row);
    }

    // Grados del plan de estudios: deben existir y ser de un nivel con plan de estudios.
    data.gradeRefs = [];
    if (data.grades) {
      const names = [...new Set(data.grades.split(/[,;]/).map((s) => s.trim()).filter(Boolean))];
      for (const gName of names) {
        const grade = ctx.gradesByName.get(normalizeHeader(gName));
        if (!grade) {
          errors.push({ column: 'grades', reason: 'grado inexistente', message: `No existe el grado "${gName}".` });
        } else if (!grade.has_curriculum) {
          errors.push({
            column: 'grades',
            reason: 'grado sin plan de estudios',
            message: `"${grade.name}" es de ${grade.level_name}: ese nivel no se organiza por materias.`,
          });
        } else if (!data.gradeRefs.includes(grade)) {
          data.gradeRefs.push(grade);
        }
      }
    }
    return { data, errors, label: data.name || null };
  },

  async insert(trx, tenantId, data) {
    const subject = await assignmentService.createSubject(trx, tenantId, {
      name: data.name,
      code: data.code,
      description: data.description,
    });
    for (const grade of data.gradeRefs) {
      const { max } = await trx('grade_subjects').where({ grade_id: grade.id }).max('sort_order as max').first();
      await trx('grade_subjects').insert({ tenant_id: tenantId, grade_id: grade.id, subject_id: subject.id, sort_order: (max ?? -1) + 1 });
    }
    const notes = data.gradeRefs.length ? [`Agregada al plan de: ${data.gradeRefs.map((g) => g.name).join(', ')}`] : [];
    return { id: subject.id, notes };
  },
};
