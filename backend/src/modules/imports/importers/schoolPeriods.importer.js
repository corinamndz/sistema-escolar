const f = require('../fields');
const { normalizeHeader } = require('../excel');
const academicService = require('../../academics/academic.service');

/** Años escolares (Paso 1 de Estructura académica). */
module.exports = {
  type: 'school-periods',
  label: 'Años escolares',
  noun: { one: 'año escolar', many: 'años escolares' },
  permission: ['academics', 'create'],
  fileName: 'plantilla-anos-escolares.xlsx',

  async prepare(trx, tenantId) {
    const existing = await trx('school_periods').where({ tenant_id: tenantId }).pluck('name');
    return {
      existingNames: new Set(existing.map(normalizeHeader)),
      columns: [
        { key: 'name', header: 'Nombre', required: true, text: true, width: 18, note: 'Ej.: 2026-2027. Máx. 30 caracteres. No puede repetirse.' },
        { key: 'startDate', header: 'Fecha de inicio', date: true, width: 18, note: 'Opcional. Formato DD/MM/AAAA.' },
        { key: 'endDate', header: 'Fecha de fin', date: true, width: 18, note: 'Opcional. Formato DD/MM/AAAA. Debe ser posterior al inicio.' },
      ],
      template: {
        title: 'Plantilla de carga masiva de años escolares',
        instructions: ['Normalmente basta con el año en curso; cargar varios sirve para registrar el historial.'],
        examples: [
          { name: '2026-2027', startDate: '14/09/2026', endDate: '23/07/2027' },
          { name: '2025-2026', startDate: '15/09/2025', endDate: '24/07/2026' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      name: [f.text, v.name, { max: 30, required: true, label: 'El nombre' }],
      startDate: [f.date, v.startDate, { label: 'La fecha de inicio' }],
      endDate: [f.date, v.endDate, { label: 'La fecha de fin' }],
    });
    if (data.startDate && data.endDate && data.endDate <= data.startDate) {
      errors.push({ column: 'endDate', reason: 'fechas inválidas', message: 'La fecha de fin debe ser posterior a la de inicio.' });
    }
    state.names ||= new Map();
    const key = data.name && normalizeHeader(data.name);
    if (key) {
      if (ctx.existingNames.has(key)) errors.push({ column: 'name', reason: 'año duplicado', message: `Ya existe el año escolar "${data.name}".` });
      else if (state.names.has(key)) errors.push({ column: 'name', reason: 'año duplicado', message: `Año repetido en la fila ${state.names.get(key)}.` });
      else state.names.set(key, state.row);
    }
    return { data, errors, label: data.name || null };
  },

  async insert(trx, tenantId, data) {
    const period = await academicService.createSchoolPeriod(trx, tenantId, {
      name: data.name,
      startDate: data.startDate || undefined,
      endDate: data.endDate || undefined,
    });
    return { id: period.id };
  },
};
