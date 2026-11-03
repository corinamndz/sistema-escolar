/**
 * Las evaluaciones se programan solo de lunes a viernes. Misma regla que
 * frontend/src/utils/weekdays.js. Las fechas son 'YYYY-MM-DD' (sin zona
 * horaria): se interpretan en UTC para que el día de la semana no se corra.
 */
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKEND_MESSAGE = 'No se pueden programar evaluaciones en fines de semana.';

const ymd = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const dayOf = (date) => new Date(`${ymd(date)}T00:00:00Z`).getUTCDay();

/** 'sábado' | 'domingo' si la fecha cae en fin de semana; null si no (o si no hay fecha). */
function weekendDay(date) {
  if (!date) return null;
  const day = dayOf(date);
  return day === 0 || day === 6 ? DAY_NAMES[day] : null;
}

/** "El 2026-11-14 es sábado: no se pueden programar…" (con prefijo: "Sección A: el 2026-11-14 es sábado…"). */
const weekendMessage = (date, prefix = '') => `${prefix}${prefix ? ' el' : 'El'} ${ymd(date)} es ${weekendDay(date)}: ${WEEKEND_MESSAGE.charAt(0).toLowerCase()}${WEEKEND_MESSAGE.slice(1)}`;

/**
 * Lleva una fecha de fin de semana al día hábil más cercano (sábado → viernes,
 * domingo → lunes), sin salirse de [min, max] si se indican. Para copias de
 * fechas (duplicar un plan a otro año), donde no hay a quién preguntarle.
 */
function nearestWeekday(date, { min = null, max = null } = {}) {
  if (!date || !weekendDay(date)) return date;
  const shift = (days) => ymd(new Date(new Date(`${ymd(date)}T00:00:00Z`).getTime() + days * 86400000));
  const day = dayOf(date);
  const before = shift(day === 6 ? -1 : -2); // viernes anterior
  const after = shift(day === 6 ? 2 : 1); // lunes siguiente
  const first = day === 6 ? before : after;
  const second = day === 6 ? after : before;
  const inRange = (d) => (!min || d >= ymd(min)) && (!max || d <= ymd(max));
  if (inRange(first)) return first;
  if (inRange(second)) return second;
  return first;
}

module.exports = { weekendDay, weekendMessage, nearestWeekday, WEEKEND_MESSAGE };
