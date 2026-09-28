const f = require('../fields');
const { normalizeHeader } = require('../excel');
const academicService = require('../../academics/academic.service');

/**
 * Aulas físicas (Paso 2, opcionales). La base no exige nombres únicos, pero
 * aquí se rechazan repetidos: las secciones referencian el aula por nombre al
 * importarlas, y dos aulas con el mismo nombre serían ambiguas.
 */
module.exports = {
  type: 'classrooms',
  label: 'Aulas',
  noun: { one: 'aula', many: 'aulas' },
  permission: ['academics', 'create'],
  fileName: 'plantilla-aulas.xlsx',

  async prepare(trx, tenantId) {
    const existing = await trx('classrooms').where({ tenant_id: tenantId }).pluck('name');
    return {
      existingNames: new Set(existing.map(normalizeHeader)),
      columns: [
        { key: 'name', header: 'Nombre', required: true, text: true, width: 20, note: 'Ej.: "Aula 3B", "Laboratorio". Máx. 60 caracteres. No puede repetirse.' },
        { key: 'capacity', header: 'Capacidad', note: 'Opcional. Cantidad de puestos (número entero mayor que 0).' },
      ],
      template: {
        title: 'Plantilla de carga masiva de aulas',
        instructions: ['Las aulas son opcionales: solo indican dónde funciona cada sección.'],
        examples: [
          { name: 'Aula 1A', capacity: 30 },
          { name: 'Laboratorio de Ciencias', capacity: 24 },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      name: [f.text, v.name, { max: 60, required: true, label: 'El nombre' }],
      capacity: [f.integer, v.capacity, { min: 1, max: 1000, label: 'La capacidad' }],
    });
    state.names ||= new Map();
    const key = data.name && normalizeHeader(data.name);
    if (key) {
      if (ctx.existingNames.has(key)) errors.push({ column: 'name', reason: 'aula duplicada', message: `Ya existe el aula "${data.name}".` });
      else if (state.names.has(key)) errors.push({ column: 'name', reason: 'aula duplicada', message: `Aula repetida en la fila ${state.names.get(key)}.` });
      else state.names.set(key, state.row);
    }
    return { data, errors, label: data.name || null };
  },

  async insert(trx, tenantId, data) {
    const classroom = await academicService.createClassroom(trx, tenantId, { name: data.name, capacity: data.capacity ?? undefined });
    return { id: classroom.id };
  },
};
