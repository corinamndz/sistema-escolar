/**
 * Las evaluaciones se programan solo de lunes a viernes (misma regla que el
 * servidor: backend/src/utils/weekdays.js). Las fechas son 'YYYY-MM-DD' de un
 * <input type="date">: se arman con año/mes/día locales para que el día de la
 * semana no se corra por la zona horaria.
 */
export const WEEKEND_MESSAGE = 'No se pueden programar evaluaciones en fines de semana.';

/** 'sábado' | 'domingo' si la fecha cae en fin de semana; null si no (o vacía). */
export function weekendDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 ? 'domingo' : day === 6 ? 'sábado' : null;
}

/** Mensaje para el campo, o null si la fecha es válida: "Es sábado: no se pueden programar…". */
export function weekendError(value) {
  const day = weekendDay(value);
  return day ? `Es ${day}: ${WEEKEND_MESSAGE.charAt(0).toLowerCase()}${WEEKEND_MESSAGE.slice(1)}` : null;
}
