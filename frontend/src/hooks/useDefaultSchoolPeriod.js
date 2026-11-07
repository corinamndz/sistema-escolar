import { useEffect, useRef } from 'react';
import { currentPeriod } from '../lib/schoolPeriods';
import { useAcademicYear } from '../context/AcademicYearContext';

/**
 * Regla única de los selectores de "Año escolar" de cada módulo, conectada al
 * AÑO ESCOLAR GLOBAL de la barra superior (context/AcademicYearContext):
 *
 *   const [periodId, setPeriodId] = useState('');
 *   useDefaultSchoolPeriod(periods, periodId, setPeriodId);
 *
 * - Al cargar, el selector del módulo queda en el año GLOBAL (si el módulo lo
 *   tiene en su lista y la página no trae ya un año, p. ej. por la URL); si no, en el año en curso (currentPeriod, misma regla
 *   que el servidor: backend/src/utils/schoolPeriods.js).
 * - Si el usuario cambia el año en la barra superior, el módulo lo sigue al
 *   instante (y recarga sus consultas, que dependen de `value`).
 * - Si el usuario cambia el año en el selector del módulo, se vuelve el año
 *   global: al pasar a otro módulo, sigue en ese año.
 * - Si el año elegido deja de existir (se eliminó), vuelve al año global / en curso.
 * - `allowAll`: el selector tiene la opción "Todos los años" (valor ''): se
 *   respeta como elección local del módulo (no cambia el año global).
 */
export function useDefaultSchoolPeriod(periods, value, setValue, { allowAll = false } = {}) {
  const { periodId: globalId, setPeriodId: setGlobalId } = useAcademicYear();
  const initialized = useRef(false);
  const lastGlobal = useRef(globalId);
  // Valor que puso el propio hook (no el usuario): no se propaga al año global.
  const own = useRef(null);
  const apply = (id) => {
    own.current = id;
    setValue(id);
  };

  // Arranque y año eliminado: el global si el módulo lo tiene; si no, el en curso.
  useEffect(() => {
    if (!periods?.length) return;
    const valid = periods.some((p) => p.id === value);
    const first = !initialized.current;
    initialized.current = true;
    // Un año que ya trae la página (p. ej. por la URL) se respeta; si no, el global.
    if (first && !valid && periods.some((p) => p.id === globalId)) {
      apply(globalId);
      return;
    }
    if (valid || (!first && allowAll && value === '')) return;
    apply(periods.some((p) => p.id === globalId) ? globalId : currentPeriod(periods).id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, value]);

  // Cambio en la barra superior → el módulo lo sigue.
  useEffect(() => {
    if (globalId === lastGlobal.current) return;
    lastGlobal.current = globalId;
    if (periods?.some((p) => p.id === globalId) && value !== globalId) apply(globalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalId]);

  // Cambio en el selector del módulo → pasa a ser el año global.
  useEffect(() => {
    if (!initialized.current || !value || value === globalId) return;
    if (value === own.current) {
      own.current = null; // lo puso el hook (arranque o seguimiento del global); el próximo cambio ya es del usuario
      return;
    }
    if (!periods?.some((p) => p.id === value)) return;
    lastGlobal.current = value;
    setGlobalId(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
