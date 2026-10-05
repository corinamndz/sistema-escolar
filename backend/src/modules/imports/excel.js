const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const { ApiError } = require('../../utils/ApiError');

/**
 * Lectura y escritura de planillas para la carga masiva.
 *
 * Cada importador define sus columnas así:
 *   { key, header, required?, note, example?, options?: string[], text?: bool, width? }
 *
 * - `header` es el texto de la fila 1; al leer se compara normalizado
 *   (sin acentos, mayúsculas ni "*"), así que "Cédula" y "cedula *" coinciden.
 * - `options` agrega una lista desplegable (validación de datos de Excel).
 *   Con `strict: true` Excel/Google Sheets RECHAZAN valores fuera de la lista;
 *   sin `strict` solo advierten (para listas que son sugerencias, ej. "Relación").
 *   Igual el backend vuelve a validar al importar: pegar celdas salta la validación.
 * - `text` fuerza formato Texto en la columna: evita que Excel convierta
 *   teléfonos ("0414…") o cédulas en números y se coma los ceros iniciales.
 */

const MAX_ROWS = 1000;
const DATA_SHEET = 'Datos';
const BRAND = 'FF4F46E5';

/** Normaliza un encabezado para compararlo: "Cédula del representante *" → "cedula del representante". */
function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Valor "plano" de una celda de ExcelJS (hipervínculos, texto enriquecido, fórmulas…). */
function plainValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return plainValue(value.result); // fórmula
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return plainValue(value.text); // hipervínculo (ej. correos)
    if ('error' in value) return null;
    return String(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value; // number | boolean
}

// ---------------------------------------------------------------------------
// Plantilla
// ---------------------------------------------------------------------------

/**
 * Genera el .xlsx de la plantilla:
 *   Hoja "Datos"         encabezados (obligatorios resaltados + comentario en cada uno),
 *                        listas desplegables y, opcionalmente, filas precargadas.
 *   Hoja "Instrucciones" qué va en cada columna y filas de ejemplo.
 *   Hoja "Listas"        (oculta) valores de las listas desplegables.
 */
/**
 * `guideTables`: tablas de referencia que se agregan a la hoja Instrucciones,
 * [{ title, headers: [...], rows: [[...], ...] }] (ej. grados y secciones válidos).
 */
async function buildTemplate({ title, columns, instructions = [], examples = [], prefill = [], hiddenKeys = [], guideTables = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema escolar';
  wb.created = new Date();

  const sheet = wb.addWorksheet(DATA_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  const guide = wb.addWorksheet('Instrucciones');
  const lists = wb.addWorksheet('Listas', { state: 'veryHidden' });

  sheet.columns = columns.map((c) => ({
    key: c.key,
    header: c.required ? `${c.header} *` : c.header,
    width: c.width || Math.max(14, c.header.length + 6),
    style: c.text ? { numFmt: '@' } : c.date ? { numFmt: 'dd/mm/yyyy' } : undefined,
    hidden: hiddenKeys.includes(c.key),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.font = { bold: true, color: { argb: c.required ? 'FFFFFFFF' : 'FF1F2937' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? BRAND : 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    if (c.note) cell.note = { texts: [{ text: c.note }], margins: { insetmode: 'auto' } };
  });

  prefill.forEach((row) => sheet.addRow(row));

  // Listas desplegables: se guardan en la hoja oculta y se referencian por rango
  // (una lista literal en la fórmula está limitada a 255 caracteres).
  let listCol = 0;
  columns.forEach((c, i) => {
    if (!c.options?.length) return;
    listCol += 1;
    const letter = lists.getColumn(listCol).letter;
    c.options.forEach((opt, j) => {
      lists.getCell(j + 1, listCol).value = opt;
    });
    const range = `Listas!$${letter}$1:$${letter}$${c.options.length}`;
    const colLetter = sheet.getColumn(i + 1).letter;
    const lastRow = Math.max(MAX_ROWS + 1, prefill.length + 1);
    sheet.dataValidations.add(`${colLetter}2:${colLetter}${lastRow}`, {
      type: 'list',
      allowBlank: !c.required,
      formulae: [range],
      showErrorMessage: true,
      errorStyle: c.strict ? 'stop' : 'warning',
      errorTitle: c.header,
      error: c.strict ? 'Elige un valor de la lista: solo se aceptan los registrados en el sistema.' : 'Elige un valor de la lista.',
      showInputMessage: Boolean(c.strict),
      promptTitle: c.header,
      prompt: c.strict ? 'Haz clic en la flecha y elige de la lista.' : undefined,
    });
  });

  // ---- Instrucciones ----
  guide.columns = [{ width: 30 }, { width: 14 }, { width: 70 }];
  guide.addRow([title]).font = { bold: true, size: 14 };
  guide.addRow([]);
  [
    `Completa la hoja "${DATA_SHEET}" a partir de la fila 2 (una fila por registro; máximo ${MAX_ROWS}).`,
    'Las columnas con fondo de color y * son obligatorias. Pasa el mouse sobre cada encabezado para ver su ayuda.',
    'No cambies ni reordenes los encabezados. Puedes borrar las filas vacías sin problema.',
    'Antes de guardar nada, el sistema valida el archivo y te muestra fila por fila qué hay que corregir.',
    ...instructions,
  ].forEach((line) => guide.addRow([`• ${line}`]));
  guide.addRow([]);

  const colHead = guide.addRow(['Columna', 'Obligatoria', 'Formato / valores permitidos']);
  colHead.font = { bold: true };
  columns
    .filter((c) => !hiddenKeys.includes(c.key))
    .forEach((c) => {
      const row = guide.addRow([c.header, c.required ? 'Sí' : 'No', c.note || '']);
      row.alignment = { wrapText: true, vertical: 'top' };
    });

  if (examples.length) {
    guide.addRow([]);
    guide.addRow(['Ejemplo (no se importa: cópialo a la hoja Datos si te sirve)']).font = { bold: true };
    const visible = columns.filter((c) => !hiddenKeys.includes(c.key));
    const exHead = guide.addRow(visible.map((c) => c.header));
    exHead.font = { bold: true, color: { argb: 'FF1F2937' } };
    exHead.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    examples.forEach((ex) => guide.addRow(visible.map((c) => ex[c.key] ?? '')));
    // Las columnas de ejemplo pueden ser más que las 3 de la guía.
    visible.forEach((c, i) => {
      if (i > 2) guide.getColumn(i + 1).width = Math.max(14, c.header.length + 4);
    });
  }

  // Tablas de referencia (ej. combinaciones válidas de grado y sección).
  guideTables.forEach((t) => {
    guide.addRow([]);
    guide.addRow([t.title]).font = { bold: true };
    const head = guide.addRow(t.headers);
    head.font = { bold: true, color: { argb: 'FF1F2937' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    t.rows.forEach((row) => guide.addRow(row));
  });

  wb.views = [{ activeTab: 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const isXlsx = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** Separador de un CSV: Excel en español exporta con ";" (la "," es el separador decimal). */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

async function loadWorkbook(buffer, originalName = '') {
  const wb = new ExcelJS.Workbook();
  if (isXlsx(buffer)) {
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw ApiError.badRequest('No se pudo leer el archivo Excel. Verifica que no esté dañado ni protegido con contraseña.');
    }
    return wb;
  }

  // CSV: texto sin bytes nulos (descarta binarios renombrados como .csv).
  if (!/\.csv$/i.test(originalName) || buffer.includes(0)) {
    throw ApiError.badRequest('Formato no permitido. Sube la plantilla en Excel (.xlsx) o CSV.');
  }
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  try {
    await wb.csv.read(Readable.from([text]), {
      parserOptions: { delimiter: detectDelimiter(text) },
      map: (value) => value, // sin conversiones automáticas: se validan igual que en Excel
      sheetName: DATA_SHEET,
    });
  } catch {
    throw ApiError.badRequest('No se pudo leer el archivo CSV.');
  }
  return wb;
}

/**
 * Lee la hoja de datos y devuelve `[{ rowNumber, values: { key: valor } }]`
 * según los encabezados. Falla con un mensaje claro si faltan columnas
 * obligatorias o si el archivo supera el máximo de filas.
 */
async function readRows(buffer, originalName, columns) {
  const wb = await loadWorkbook(buffer, originalName);
  const sheet = wb.getWorksheet(DATA_SHEET) || wb.worksheets.find((ws) => ws.state !== 'veryHidden' && ws.state !== 'hidden');
  if (!sheet) throw ApiError.badRequest('El archivo no tiene hojas con datos.');

  const byHeader = new Map(columns.map((c) => [normalizeHeader(c.header), c]));
  columns.forEach((c) => (c.aliases || []).forEach((a) => byHeader.set(normalizeHeader(a), c)));

  const colIndex = {}; // key → número de columna
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const col = byHeader.get(normalizeHeader(plainValue(cell.value)));
    if (col && !colIndex[col.key]) colIndex[col.key] = colNumber;
  });

  // `mustExist`: columna que debe estar aunque sus celdas puedan ir vacías (ej. actividades).
  const missing = columns.filter((c) => (c.required || c.mustExist) && !colIndex[c.key]);
  if (missing.length) {
    throw ApiError.badRequest(
      `Faltan columnas en el archivo: ${missing.map((c) => c.header).join(', ')}. Descarga la plantilla y no cambies los encabezados.`,
      missing.map((c) => ({ path: c.key, message: `Falta la columna "${c.header}".` }))
    );
  }

  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const values = {};
    let hasData = false;
    for (const [key, colNumber] of Object.entries(colIndex)) {
      const v = plainValue(row.getCell(colNumber).value);
      values[key] = v;
      if (v !== null) hasData = true;
    }
    if (!hasData) continue; // filas vacías o con formato solamente
    rows.push({ rowNumber: r, values });
    if (rows.length > MAX_ROWS) {
      throw ApiError.badRequest(`El archivo tiene más de ${MAX_ROWS} filas con datos. Divídelo en varios archivos.`);
    }
  }
  return rows;
}

module.exports = { buildTemplate, readRows, normalizeHeader, MAX_ROWS };
