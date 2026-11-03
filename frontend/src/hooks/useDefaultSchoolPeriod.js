import { useEffect, useRef } from 'react';
import { currentPeriod } from '../lib/schoolPeriods';

/**
 * Regla única de los selectores de "Año escolar": al cargar la lista, el
 * selector queda en el año EN CURSO del colegio (currentPeriod: el activo que
 * contiene la fecha de hoy; con el año siguiente ya preparado, sigue siendo el
 * actual). El servidor usa la misma regla (backend/src/utils/schoolPeriods.js)
 * cuando la petición no indica año.
 *
 *   const [periodId, setPeriodId] = useState('');
 *   useDefaultSchoolPeriod(periods, periodId, setPeriodId);
 *
 * - Respeta un año ya elegido (por la URL o por el usuario) si existe en la lista.
 * - Si el año elegido deja de existir (se eliminó), vuelve al año en curso.
 * - `allowAll`: el selector tiene la opción "Todos los años" (valor ''): se
 *   arranca en el año en curso, pero si el usuario elige "Todos" se respeta.
 */
export function useDefaultSchoolPeriod(periods, value, setValue, { allowAll = false } = {}) {
  const initialized = useRef(false);
  useEffect(() => {
    if (!periods?.length) return;
    const valid = periods.some((p) => p.id === value);
    const first = !initialized.current;
    initialized.current = true;
    if (valid || (!first && allowAll && value === '')) return;
    setValue(currentPeriod(periods).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, value]);
}
