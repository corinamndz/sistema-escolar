import { useEffect, useRef } from 'react';

/**
 * Refresco "en vivo" sin websockets: llama a `refresh` cada `ms` mientras la
 * pestaña está visible y, además, apenas se vuelve a ella (foco). Así un cambio
 * hecho en otro panel (p. ej. el representante confirma una cita) aparece solo.
 * `refresh` debe ser silencioso (sin spinner): actualizar los datos y listo.
 */
export function useLiveRefresh(refresh, ms = 20000, enabled = true) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => document.visibilityState === 'visible' && ref.current?.();
    const timer = setInterval(run, ms);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [ms, enabled]);
}
