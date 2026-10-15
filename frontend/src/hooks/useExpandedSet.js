import { useCallback, useEffect, useState } from 'react';

/**
 * Estado de grupos plegables (acordeones, grupos del menú, materias…) con la
 * convención del sistema: TODO CERRADO POR DEFECTO. Se guarda qué abrió el
 * usuario (no qué cerró), así un grupo nuevo o la primera visita aparecen
 * contraídos y solo se expande lo que se quiere consultar.
 *
 *   storageKey  opcional: recuerda lo abierto en este navegador
 *               (si el almacenamiento no está disponible, dura la sesión).
 *
 * Devuelve { isOpen(key), toggle(key), open(key), expandAll(keys), collapseAll(), openKeys }.
 */
export function useExpandedSet(storageKey = null) {
  const read = useCallback(() => {
    if (!storageKey) return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
    } catch {
      return new Set();
    }
  }, [storageKey]);

  const [openKeys, setOpenKeys] = useState(read);
  // Otra clave (p. ej. otro alumno): su propia preferencia.
  useEffect(() => setOpenKeys(read()), [read]);

  const persist = useCallback(
    (next) => {
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // sin almacenamiento (modo privado): solo dura mientras la página esté abierta
      }
    },
    [storageKey],
  );

  const update = useCallback(
    (fn) =>
      setOpenKeys((prev) => {
        const next = fn(new Set(prev));
        persist(next);
        return next;
      }),
    [persist],
  );

  const toggle = useCallback((key) => update((s) => (s.has(key) ? (s.delete(key), s) : s.add(key))), [update]);
  const open = useCallback((key) => update((s) => s.add(key)), [update]);
  const expandAll = useCallback((keys) => update((s) => (keys.forEach((k) => s.add(k)), s)), [update]);
  const collapseAll = useCallback(() => update(() => new Set()), [update]);
  const isOpen = useCallback((key) => openKeys.has(key), [openKeys]);

  return { isOpen, toggle, open, expandAll, collapseAll, openKeys };
}

export default useExpandedSet;
