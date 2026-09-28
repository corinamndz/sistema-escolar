const { z } = require('zod');
const { normalizeHeader } = require('./excel');

/**
 * Parsers de celdas para la carga masiva. Todos reciben el valor ya "plano"
 * (ver excel.plainValue) y devuelven `{ value }` o `{ error }`, así cada
 * importador acumula TODOS los errores de una fila en vez de cortar en el primero.
 */

/** Texto con longitud máxima (la de la columna en la base). Vacío → null. */
function text(v, { max, required, label }) {
  if (v === null || v === undefined || String(v).trim() === '') {
    return required ? { error: `${label} es obligatorio.` } : { value: null };
  }
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  if (max && s.length > max) return { error: `${label} admite hasta ${max} caracteres (tiene ${s.length}).` };
  return { value: s };
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Fecha → 'YYYY-MM-DD'. Acepta celdas de fecha de Excel, número de serie de
 * Excel, 'DD/MM/AAAA', 'DD-MM-AAAA' y 'AAAA-MM-DD'. Rechaza fechas imposibles
 * (31/02) y, con `notFuture`, las posteriores a `today` ('YYYY-MM-DD').
 */
function date(v, { label, notFuture, today, required }) {
  if (v === null || v === undefined || v === '') return required ? { error: `${label} es obligatoria.` } : { value: null };

  let y;
  let m;
  let d;
  if (v instanceof Date) {
    // ExcelJS entrega las fechas en UTC a medianoche.
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === 'number') {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = String(v).trim();
    let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) [, d, m, y] = match.map(Number);
    else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = match.map(Number);
    else return { error: `${label}: usa el formato DD/MM/AAAA (recibido "${s}").` };
  }

  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d || y < 1900) {
    return { error: `${label}: la fecha no existe.` };
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  if (notFuture && today && iso > today) return { error: `${label} no puede ser futura.` };
  return { value: iso };
}

/**
 * Cédula tal como se guarda (sin espacios ni puntos, en mayúsculas):
 * "v- 12.345.678" → "V-12345678".
 */
function nationalId(v, { label = 'La cédula', required } = {}) {
  const t = text(typeof v === 'number' ? String(v) : v, { max: 30, required, label });
  if (t.error || t.value === null) return t;
  const value = t.value.replace(/[\s.]/g, '').toUpperCase();
  // V-12345678, E-8123456, 12345678 o un pasaporte alfanumérico.
  if (!/^[A-Z0-9-]{5,30}$/.test(value) || !/\d{4}/.test(value)) return { error: `${label} tiene un formato inválido ("${t.value}").` };
  return { value };
}

/** Clave para comparar cédulas sin importar el formato: "V-12.345.678" ≡ "v12345678". */
const idKey = (value) => (value ? String(value).replace(/[\s.-]/g, '').toUpperCase() : null);
/** Misma normalización, en SQL, para comparar contra lo ya guardado. */
const ID_KEY_SQL = (column) => `upper(regexp_replace(${column}, '[[:space:].-]', '', 'g'))`;

const emailSchema = z.string().email();
function email(v, { label = 'El correo' } = {}) {
  const t = text(v, { max: 150, label });
  if (t.error || t.value === null) return t;
  const value = t.value.toLowerCase();
  return emailSchema.safeParse(value).success ? { value } : { error: `${label} no es válido ("${t.value}").` };
}

/**
 * Valor de una lista cerrada. `options` = { 'Texto visible': valorInterno };
 * `aliases` = otras formas aceptadas que no se listan en el mensaje de error.
 */
function option(v, { options, aliases = {}, label, required }) {
  if (v === null || v === undefined || v === '') return required ? { error: `${label} es obligatorio.` } : { value: null };
  const wanted = normalizeHeader(v);
  const hit = Object.entries({ ...options, ...aliases }).find(([visible]) => normalizeHeader(visible) === wanted);
  return hit ? { value: hit[1] } : { error: `${label}: "${v}" no es válido. Usa: ${Object.keys(options).join(', ')}.` };
}

/** Sí/No (también acepta true/false, 1/0, "x"). */
function yesNo(v, { label, defaultValue = false }) {
  if (v === null || v === undefined || v === '') return { value: defaultValue };
  if (typeof v === 'boolean') return { value: v };
  const s = normalizeHeader(v);
  if (['si', 's', 'x', '1', 'true', 'verdadero'].includes(s)) return { value: true };
  if (['no', 'n', '0', 'false', 'falso'].includes(s)) return { value: false };
  return { error: `${label}: escribe "Sí" o "No".` };
}

/** Nota numérica en [min, max]; admite coma decimal ("15,5"). */
function score(v, { label, min = 0, max = 20 }) {
  if (v === null || v === undefined || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return { error: `${label}: "${v}" no es un número.` };
  if (n < min || n > max) return { error: `${label}: la nota debe estar entre ${min} y ${max} (recibido ${n}).` };
  return { value: Math.round(n * 100) / 100 };
}

/** Entero en [min, max]. Vacío → null (o error si es obligatorio). */
function integer(v, { label, min = 0, max = 100000, required }) {
  if (v === null || v === undefined || v === '') return required ? { error: `${label} es obligatorio.` } : { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isInteger(n)) return { error: `${label}: "${v}" no es un número entero.` };
  if (n < min || n > max) return { error: `${label} debe estar entre ${min} y ${max}.` };
  return { value: n };
}

/**
 * Aplica varios parsers a una fila y junta resultados:
 *   const { data, errors } = collect({ firstName: [fields.text, values.firstName, {...}], ... })
 */
function collect(spec) {
  const data = {};
  const errors = [];
  for (const [key, [fn, value, opts]] of Object.entries(spec)) {
    const r = fn(value, opts);
    if (r.error) errors.push({ column: key, message: r.error });
    else data[key] = r.value;
  }
  return { data, errors };
}

module.exports = { text, date, nationalId, idKey, ID_KEY_SQL, email, option, yesNo, score, integer, collect };
