import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { axiosClient } from '../api/axiosClient';
import { useAuth } from './AuthContext';
import { currentPeriod } from '../lib/schoolPeriods';

/**
 * Año escolar GLOBAL (selector de la barra superior).
 *
 * Un solo año elegido para toda la aplicación: los módulos lo leen de aquí en
 * vez de guardar cada uno su propio año. Se recuerda en el navegador
 * (localStorage, por colegio y usuario), así que se mantiene al recargar o al
 * navegar entre secciones. Si el año guardado ya no existe, vuelve al año EN
 * CURSO del colegio (misma regla que el servidor: currentPeriod).
 *
 *   const { period, periodId, setPeriodId, periods, currentId, isCurrent } = useAcademicYear();
 *
 * Los selectores de año de cada módulo se sincronizan solos con este valor a
 * través de useDefaultSchoolPeriod (hooks/useDefaultSchoolPeriod.js).
 * El portal del representante no lo usa: siempre ve el año en curso.
 */
const AcademicYearContext = createContext(null);

const storageKey = (user) => `modo:academic-year:${user?.tenantSlug || 'default'}:${user?.id || 'anon'}`;
const readStored = (key) => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return ''; // navegación privada o almacenamiento bloqueado: se usa el año en curso
  }
};

function AcademicYearProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const key = storageKey(user);
  const [data, setData] = useState({ periods: [], currentId: null, loading: isAuthenticated });
  const [chosenId, setChosenId] = useState(() => readStored(key));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let alive = true;
    setData((d) => ({ ...d, loading: true }));
    axiosClient
      .get('/school-years')
      .then(({ data: r }) => alive && setData({ periods: r.periods || [], currentId: r.currentId || currentPeriod(r.periods || [])?.id || null, loading: false }))
      .catch(() => alive && setData({ periods: [], currentId: null, loading: false }));
    return () => {
      alive = false;
    };
  }, [isAuthenticated, user?.id, version]);

  // Otro usuario / colegio en la misma pestaña: su propia selección guardada.
  useEffect(() => setChosenId(readStored(key)), [key]);

  // El elegido debe existir; si no (año eliminado o nada guardado), el año en curso.
  const periodId = data.periods.some((p) => p.id === chosenId) ? chosenId : data.currentId || '';
  const period = data.periods.find((p) => p.id === periodId) || null;

  const setPeriodId = useCallback(
    (id) => {
      setChosenId(id || '');
      try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
      } catch {
        // preferencia no persistente
      }
    },
    [key]
  );

  const value = useMemo(
    () => ({
      periods: data.periods,
      loading: data.loading,
      currentId: data.currentId,
      periodId,
      period,
      isCurrent: Boolean(periodId) && periodId === data.currentId,
      setPeriodId,
      // Volver al año en curso (botón «Ir al año en curso»).
      resetToCurrent: () => setPeriodId(''),
      // Recargar la lista (p. ej. después de crear o eliminar un año escolar).
      refreshPeriods: () => setVersion((v) => v + 1),
    }),
    [data, periodId, period, setPeriodId]
  );
  return <AcademicYearContext.Provider value={value}>{children}</AcademicYearContext.Provider>;
}

/** Año escolar global. Fuera del proveedor devuelve un valor vacío (no rompe componentes sueltos). */
function useAcademicYear() {
  return (
    useContext(AcademicYearContext) || {
      periods: [],
      loading: false,
      currentId: null,
      periodId: '',
      period: null,
      isCurrent: false,
      setPeriodId: () => {},
      resetToCurrent: () => {},
      refreshPeriods: () => {},
    }
  );
}

export { AcademicYearProvider, useAcademicYear };
