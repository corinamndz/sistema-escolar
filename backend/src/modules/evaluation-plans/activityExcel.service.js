const { ApiError } = require('../../utils/ApiError');
const { buildTemplate, readRows, normalizeHeader } = require('../imports/excel');
const f = require('../imports/fields');

/**
 * Una actividad de evaluación en formato detallado desde Excel, para llenar el
 * formulario "Incluir evaluación" (no guarda nada: el usuario revisa y guarda).
 *
 * Hoja "Datos": UNA FILA POR INDICADOR. Los datos de la actividad (actividad,
 * tipo, porcentaje, instrumento, estrategia, puntaje, descripción y fechas) se
 * toman de la primera fila que los tenga. El criterio se escribe en su primer
 * indicador; las filas siguientes con el criterio vacío siguen en el mismo.
 * "Referencias": "Tema: subtema; subtema" (una por fila, opcional).
 */

const CATEGORIES = { Formativa: 'formative', Examen: 'exam', Proyecto: 'project', Tarea: 'homework', Otra: 'other' };
const INSTRUMENTS = {
  Rúbrica: 'rubric',
  'Escala de estimación': 'estimation_scale',
  'Lista de cotejo': 'checklist',
  'Prueba escrita': 'written_test',
  'Registro de observación': 'observation_record',
  Otro: 'other',
};

const round2 = (n) => Math.round(n * 100) / 100;
const dateKey = (name) => `date_${normalizeHeader(name).replace(/[^a-z0-9]/g, '_')}`;

/** `sectionNames`: secciones de la actividad → una columna de fecha por sección. */
function columnsFor(sectionNames = []) {
  return [
    { key: 'title', header: 'Actividad', required: true, width: 30, note: 'Nombre de la actividad o instrumento (máx. 200). Basta con escribirlo en la primera fila.' },
    { key: 'category', header: 'Tipo', mustExist: true, width: 14, options: Object.keys(CATEGORIES), note: `Tipo de evaluación: ${Object.keys(CATEGORIES).join(', ')}. Por defecto, Formativa.` },
    { key: 'weight', header: 'Porcentaje', required: true, width: 12, note: 'Porcentaje de la nota del lapso (ej. 20). Basta con la primera fila.' },
    { key: 'instrument', header: 'Instrumento', width: 22, options: Object.keys(INSTRUMENTS), note: 'Opcional. Elige de la lista.' },
    { key: 'strategy', header: 'Estrategia evaluativa', width: 26, note: 'Opcional (máx. 200). Ej. trabajo en parejas.' },
    { key: 'maxScore', header: 'Puntaje total', width: 13, note: 'Opcional: puntaje de la actividad. Si lo dejas vacío, es la suma de los puntajes de los indicadores.' },
    { key: 'refs', header: 'Referencias', width: 34, note: 'Opcional. Un tema por fila con sus subtemas: "Tema: subtema; subtema".' },
    { key: 'description', header: 'Descripción', width: 30, note: 'Opcional (máx. 1000): instrucciones generales.' },
    { key: 'criterion', header: 'Criterio', required: true, width: 30, note: 'Escríbelo en su primer indicador; deja la celda vacía en los siguientes indicadores del mismo criterio.' },
    { key: 'indicator', header: 'Indicador', required: true, width: 40, note: 'Un indicador de logro por fila.' },
    { key: 'points', header: 'Puntaje del indicador', required: true, width: 14, note: 'Puntos del indicador (mayor que 0; admite decimales con coma).' },
    { key: 'date', header: 'Fecha de aplicación', date: true, width: 16, note: 'Opcional (DD/MM/AAAA): fecha para todas las secciones.' },
    ...sectionNames.map((name) => ({
      key: dateKey(name),
      header: `Fecha Sección ${name}`,
      date: true,
      width: 16,
      note: `Opcional (DD/MM/AAAA): fecha en la sección ${name}; reemplaza a la fecha general.`,
    })),
  ];
}

async function generateTemplate({ sectionNames = [], topic } = {}) {
  const columns = columnsFor(sectionNames);
  return buildTemplate({
    title: topic ? `Evaluación detallada — ${topic}` : 'Evaluación detallada',
    columns,
    instructions: [
      'Una fila por INDICADOR. Los datos de la actividad (actividad, tipo, porcentaje, instrumento, estrategia, puntaje y fechas) van solo en la primera fila.',
      'Escribe el criterio en su primer indicador y deja la celda vacía en los demás indicadores del mismo criterio.',
      'Los puntajes de los indicadores deben sumar el puntaje total de la actividad.',
      'Al subir el archivo se completa el formulario: revisa los datos y guarda la evaluación.',
    ],
    examples: [
      { title: 'Taller de la célula', category: 'Formativa', weight: 20, instrument: 'Rúbrica', strategy: 'Trabajo en parejas', maxScore: 20, refs: 'La célula: tipos; organelos', criterion: 'Conceptualización', indicator: 'Define célula con sus palabras', points: 5, date: '15/10/2026' },
      { criterion: '', indicator: 'Distingue célula animal y vegetal', points: 5 },
      { refs: 'Membrana celular', criterion: 'Aplicación', indicator: 'Identifica organelos en un esquema', points: 6 },
      { criterion: '', indicator: 'Explica la función de cada organelo', points: 4 },
    ],
  });
}

/** "Tema: sub; sub" → { topic, subtopics } */
function parseRef(value) {
  const [topic, rest = ''] = String(value).split(/:(.*)/s);
  return { topic: topic.trim(), subtopics: rest.split(/[;\n]/).map((s) => s.trim()).filter(Boolean) };
}

function number(v, label) {
  if (v === null || v === undefined || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n)) return { error: `${label}: "${v}" no es un número.` };
  return { value: round2(n) };
}

/**
 * Lee el archivo y devuelve los datos para el formulario:
 * { activity: { title, category, weightPercent, instrument, strategy, maxScore, description,
 *   contentRefs, criteria: [{ title, indicators: [{ description, points }] }], date,
 *   sectionDates: { [nombreSección]: 'YYYY-MM-DD' } }, warnings }
 * Con errores responde 400 indicando la fila.
 */
async function parseActivity(buffer, originalName, { sectionNames = [] } = {}) {
  const columns = columnsFor(sectionNames);
  const rows = await readRows(buffer, originalName, columns);
  if (!rows.length) throw ApiError.badRequest('El archivo no tiene filas con datos. Completa la hoja "Datos" a partir de la fila 2.');

  const errors = [];
  const fail = (row, message) => errors.push({ path: `fila ${row}`, message: `Fila ${row}: ${message}` });
  const first = (key) => rows.find((r) => r.values[key] !== null && r.values[key] !== undefined);
  const take = (key, parser) => {
    const r = first(key);
    if (!r) return null;
    const out = parser(r.values[key]);
    if (out.error) fail(r.rowNumber, out.error);
    return out.value ?? null;
  };

  const title = take('title', (v) => f.text(v, { max: 200, label: 'La actividad' }));
  if (!title) errors.push({ path: 'title', message: 'Falta el nombre de la actividad (columna "Actividad").' });
  const category = take('category', (v) => f.option(v, { options: CATEGORIES, label: 'El tipo' })) || 'formative';
  const weightPercent = take('weight', (v) => number(v, 'El porcentaje'));
  if (weightPercent === null) errors.push({ path: 'weight', message: 'Falta el porcentaje de la actividad (columna "Porcentaje").' });
  else if (!(weightPercent > 0 && weightPercent <= 100)) errors.push({ path: 'weight', message: 'El porcentaje debe ser mayor que 0 y hasta 100.' });
  const instrument = take('instrument', (v) => f.option(v, { options: INSTRUMENTS, label: 'El instrumento' }));
  const strategy = take('strategy', (v) => f.text(v, { max: 200, label: 'La estrategia' }));
  const description = take('description', (v) => f.text(v, { max: 1000, label: 'La descripción' }));
  const maxScoreCell = take('maxScore', (v) => number(v, 'El puntaje total'));
  const date = take('date', (v) => f.date(v, { label: 'La fecha de aplicación' }));
  const sectionDates = {};
  sectionNames.forEach((name) => {
    const d = take(dateKey(name), (v) => f.date(v, { label: `La fecha de la sección ${name}` })) || date;
    if (d) sectionDates[name] = d;
  });

  const contentRefs = rows.filter((r) => r.values.refs).map((r) => parseRef(r.values.refs)).filter((t) => t.topic);

  // Criterios e indicadores: una fila por indicador; el criterio vacío continúa el anterior.
  const criteria = [];
  rows.forEach(({ rowNumber, values }) => {
    const crit = f.text(values.criterion, { max: 300, label: 'El criterio' });
    const ind = f.text(values.indicator, { max: 1000, label: 'El indicador' });
    const pts = number(values.points, 'El puntaje del indicador');
    [crit, ind, pts].forEach((r) => r.error && fail(rowNumber, r.error));
    if (crit.error || ind.error || pts.error) return;

    if (crit.value) {
      const current = criteria[criteria.length - 1];
      if (!current || normalizeHeader(current.title) !== normalizeHeader(crit.value)) criteria.push({ title: crit.value, indicators: [] });
    }
    if (!ind.value && pts.value === null) return; // fila solo con datos de la actividad o referencias
    if (!criteria.length) return fail(rowNumber, 'escribe el criterio de este indicador (columna "Criterio").');
    if (!ind.value) return fail(rowNumber, 'falta el texto del indicador.');
    if (pts.value === null) return fail(rowNumber, `falta el puntaje del indicador "${ind.value}".`);
    if (!(pts.value > 0)) return fail(rowNumber, 'el puntaje del indicador debe ser mayor que 0.');
    criteria[criteria.length - 1].indicators.push({ description: ind.value, points: pts.value });
  });
  criteria
    .filter((c) => !c.indicators.length)
    .forEach((c) => errors.push({ path: 'criterion', message: `El criterio "${c.title}" no tiene indicadores.` }));
  if (!criteria.length && !errors.length) errors.push({ path: 'criterion', message: 'El archivo no tiene criterios con indicadores.' });

  if (errors.length) {
    const shown = errors.slice(0, 6).map((e) => e.message);
    const more = errors.length > shown.length ? ` (y ${errors.length - shown.length} más)` : '';
    throw ApiError.badRequest(`Revisa el archivo: ${shown.join(' ')}${more}`, errors);
  }

  const total = round2(criteria.flatMap((c) => c.indicators).reduce((n, i) => n + i.points, 0));
  const maxScore = maxScoreCell ?? total;
  const warnings = [];
  if (maxScoreCell !== null && maxScoreCell !== total) {
    warnings.push(`Los indicadores suman ${total} pts y el puntaje total indicado es ${maxScoreCell}: ajústalo antes de guardar.`);
  }

  return {
    activity: { title, category, weightPercent, instrument, strategy, description, maxScore, contentRefs, criteria, date, sectionDates },
    summary: { criteria: criteria.length, indicators: criteria.reduce((n, c) => n + c.indicators.length, 0), total },
    warnings,
  };
}

module.exports = { generateTemplate, parseActivity };
