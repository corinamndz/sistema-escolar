const f = require('../fields');
const { normalizeHeader } = require('../excel');
const { ApiError } = require('../../../utils/ApiError');
const contentService = require('../../programmatic-content/programmaticContent.service');

/** Clave normalizada para detectar temas duplicados (misma unidad + mismo tema). */
const topicKey = (unit, topic) => `${normalizeHeader(unit)}|${normalizeHeader(topic)}`;

/**
 * Importador de contenido programático (unidades, temas y descripciones) para
 * una combinación específica de grado y materia.
 *
 * Params requeridos en la URL (query string):
 *   gradeId   UUID del grado
 *   subjectId UUID de la materia
 */
module.exports = {
  type: 'programmatic_content',
  label: 'Contenido programático',
  noun: { one: 'tema', many: 'temas' },
  permission: ['evaluation_plans', 'create'],
  fileName: 'plantilla-contenido-programatico.xlsx',

  async prepare(trx, tenantId, params) {
    const { gradeId, subjectId } = params || {};
    if (!gradeId || !subjectId) {
      throw ApiError.badRequest('Indica el grado y la materia antes de descargar la plantilla.');
    }

    const gradeSubject = await trx('grade_subjects as gs')
      .join('grades as g', 'g.id', 'gs.grade_id')
      .join('subjects as s', 's.id', 'gs.subject_id')
      .where({ 'gs.grade_id': gradeId, 'gs.subject_id': subjectId, 'g.tenant_id': tenantId })
      .select('g.name as grade_name', 's.name as subject_name')
      .first();
    if (!gradeSubject) throw ApiError.notFound('Combinación de grado y materia no encontrada.');

    const existing = await trx('programmatic_content')
      .where({ tenant_id: tenantId, grade_id: gradeId, subject_id: subjectId })
      .select('unit', 'topic')
      .orderBy('sort_order');

    const existingKeys = new Set(existing.map((r) => topicKey(r.unit, r.topic)));
    const existingUnits = [...new Set(existing.map((r) => r.unit))].sort(contentService.compareUnits);

    const columns = [
      { key: 'unit',        header: 'Unidad',       required: true, width: 22, note: 'Nombre de la unidad (ej. "Unidad I"). Máx. 100 caracteres. Usa el mismo texto exacto para agrupar varios temas en la misma unidad.' },
      { key: 'topic',       header: 'Tema',          required: true, width: 36, note: 'Nombre del tema dentro de la unidad. Máx. 200 caracteres. No puede repetirse en la misma unidad.' },
      { key: 'description', header: 'Descripción',   required: true, width: 52, note: 'Descripción o contenido del tema. Máx. 4 000 caracteres.' },
    ];

    return {
      gradeId,
      subjectId,
      gradeName: gradeSubject.grade_name,
      subjectName: gradeSubject.subject_name,
      existingKeys,
      columns,
      template: {
        fileName: 'plantilla-contenido-programatico.xlsx',
        title: `Contenido programático — ${gradeSubject.subject_name} (${gradeSubject.grade_name})`,
        instructions: [
          'Cada fila representa un tema. Repite el mismo nombre de unidad para agrupar varios temas bajo una misma unidad.',
          'Los temas se agregan en el orden del archivo, a continuación de los ya existentes.',
          'Los temas duplicados (misma unidad + mismo nombre de tema ya registrado) se omiten sin error.',
        ],
        ...(existingUnits.length && {
          guideTables: [{
            title: `Unidades actuales — ${gradeSubject.subject_name} (${gradeSubject.grade_name})`,
            headers: ['Unidad', 'Temas registrados'],
            rows: existingUnits.map((u) => [u, existing.filter((r) => r.unit === u).length]),
          }],
        }),
        examples: [
          { unit: 'Unidad I',   topic: 'Introducción a la célula', description: 'Concepto de célula, tipos y funciones básicas.' },
          { unit: 'Unidad I',   topic: 'Estructura celular',        description: 'Membrana plasmática, núcleo, mitocondrias y organelos.' },
          { unit: 'Unidad II',  topic: 'División celular',          description: 'Mitosis y meiosis: fases y diferencias.' },
        ],
      },
    };
  },

  validate(v, ctx, state) {
    const { data, errors } = f.collect({
      unit:        [f.text, v.unit,        { max: 100,  required: true, label: 'La unidad' }],
      topic:       [f.text, v.topic,       { max: 200,  required: true, label: 'El tema' }],
      description: [f.text, v.description, { max: 4000, required: true, label: 'La descripción' }],
    });
    const label = data.topic || null;

    if (!errors.length && data.unit && data.topic) {
      const k = topicKey(data.unit, data.topic);

      // Ya existe en la base de datos: omitir sin error.
      if (ctx.existingKeys.has(k)) {
        return { data, errors: [], label, skip: true };
      }

      // Duplicado dentro del mismo archivo.
      state.keys ||= new Map();
      if (state.keys.has(k)) {
        errors.push({
          column: 'topic',
          reason: 'tema duplicado',
          message: `El tema "${data.topic}" se repite en la fila ${state.keys.get(k)}.`,
        });
      } else {
        state.keys.set(k, state.row);
      }
    }

    return { data, errors, label };
  },

  async insert(trx, tenantId, data, ctx) {
    await contentService.createItem(trx, tenantId, {
      gradeId:     ctx.gradeId,
      subjectId:   ctx.subjectId,
      unit:        data.unit,
      topic:       data.topic,
      description: data.description,
    });
    return {};
  },
};
