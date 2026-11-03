/**
 * Año escolar "en curso" del colegio: MISMA regla que currentPeriod() del
 * frontend (frontend/src/lib/schoolPeriods.js), para que el año que el
 * servidor elige por defecto sea el mismo que muestran los selectores:
 *   1. abierto y activo que contiene la fecha de hoy;
 *   2. si no, el abierto y activo que empezó más recientemente (sin contar los
 *      que aún no empiezan, como el año siguiente ya creado);
 *   3. si no, el abierto y activo; luego cualquier abierto; al final los cerrados.
 * Dentro de cada grupo, el que empezó más tarde primero.
 *
 * Con varios años marcados como activos (el en curso y el siguiente ya
 * preparado), ordenar solo por "is_active DESC, start_date DESC" elegía el
 * año siguiente: esta expresión lo evita.
 *
 *   .orderByRaw(currentPeriodOrder('sp'))       // alias de school_periods
 *   ORDER BY ${currentPeriodOrder('sp')}, e.enrolled_at DESC
 */
function currentPeriodOrder(alias = '') {
  const c = (col) => (alias ? `${alias}.${col}` : col);
  return `CASE
      WHEN ${c('closed_at')} IS NULL AND ${c('is_active')} AND ${c('start_date')} <= CURRENT_DATE
           AND (${c('end_date')} IS NULL OR ${c('end_date')} >= CURRENT_DATE) THEN 0
      WHEN ${c('closed_at')} IS NULL AND ${c('is_active')} AND ${c('start_date')} <= CURRENT_DATE THEN 1
      WHEN ${c('closed_at')} IS NULL AND ${c('is_active')} THEN 2
      WHEN ${c('closed_at')} IS NULL THEN 3
      ELSE 4
    END, ${c('start_date')} DESC NULLS LAST`;
}

module.exports = { currentPeriodOrder };
