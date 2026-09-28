const f = require('../fields');
const { normalizeHeader } = require('../excel');
const academicService = require('../../academics/academic.service');

const LEVELS = { Inicial: 'initial', Primaria: 'primary', Secundaria: 'secondary' };
const LEVEL_ALIASES = {
  'Educación Inicial': 'initial',
  Preescolar: 'initial',
  'Educación Primaria': 'primary',
  'Educación Secundaria': 'secondary',
  'Media General': 'secondary',
  Bachillerato: 'secondary',
};

/** Grados (Paso 2). El nivel define cómo se asignan los docentes de sus secciones. */
module.exports = {
  type: 'grades',
  label: 'Grados',
  noun: { one: 'grado', many: 'grados' },
  permission: ['academics', 'create'],
  fileName: 'plantilla-grados.xlsx',

  async prepare(trx, tenantId) {
    const existing = await trx('grades').where({ tenant_id: tenantId }).pluck('name');
    return {
      existingNames: new Set(existing.map(normalizeHeader)),
      columns: [
        { key: 'name', header: 'Nombre', required: true, width: 20, note: 'Ej.: "Sala 5", "3er grado", "1er año". Máx. 60 caracteres. No puede repetirse.' },
        {
          key: 'levelCode',
          header: 'Nivel',
          required: true,
          options: Object.keys(LEVELS),
          width: 16,
          note: 'Inicial (titular + auxiliar por sección), Primaria (un docente por sección) o Secundaria (un profesor por materia).',
        },
        { key: 'sortOrder', header: 'Orden', note: 'Opcional. Número para ordenar los grados dentro del nivel (1, 2, 3…).' },
      ],
      template: {
        title: 'Plantilla de carga masiva de grados',
        instructions: ['El nivel no se puede cambiar fácilmente después si el grado ya tiene secciones con docentes: elígelo con cuidado.'],
        examples: [
          { name: 'Sala 5', levelCode: 'Inicial', sortOrder: 3 },
          { name: '1er grado', levelCode: 'Primaria', sortOrder: 1 },
          { name: '1er año', levelCode: 'Secundaria', sortOrder: 1 },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      name: [f.text, v.name, { max: 60, required: true, label: 'El nombre' }],
      levelCode: [f.option, v.levelCode, { options: LEVELS, aliases: LEVEL_ALIASES, required: true, label: 'El nivel' }],
      sortOrder: [f.integer, v.sortOrder, { min: 0, max: 1000, label: 'El orden' }],
    });
    state.names ||= new Map();
    const key = data.name && normalizeHeader(data.name);
    if (key) {
      if (ctx.existingNames.has(key)) errors.push({ column: 'name', reason: 'grado duplicado', message: `Ya existe el grado "${data.name}".` });
      else if (state.names.has(key)) errors.push({ column: 'name', reason: 'grado duplicado', message: `Grado repetido en la fila ${state.names.get(key)}.` });
      else state.names.set(key, state.row);
    }
    return { data, errors, label: data.name || null };
  },

  async insert(trx, tenantId, data) {
    const grade = await academicService.createGrade(trx, tenantId, {
      name: data.name,
      levelCode: data.levelCode,
      sortOrder: data.sortOrder ?? undefined,
    });
    return { id: grade.id };
  },
};
