import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import platformLogo from '../../assets/modo-educa-logo.png';

/** Duración del fundido de salida; debe coincidir con `.splash` en index.css. */
const FADE_MS = 450;
/** Tope de espera: si el logo del colegio no responde, la app se muestra igual. */
const MAX_WAIT_MS = 5000;

/** Resuelve cuando la imagen terminó de cargar (o falló): así no "aparece" a medias tras el splash. */
function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve();
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

/**
 * Pantalla de inicio de MoDo Educa: logo grande y centrado sobre fondo limpio
 * mientras se valida la sesión guardada y se carga la marca del colegio
 * (configuración + logo). Cuando todo está listo se desvanece y se desmonta.
 * Solo actúa en el arranque: los refrescos posteriores de la configuración
 * (al volver a la pestaña) no la vuelven a mostrar.
 */
function SplashScreen() {
  const { initializing, isAuthenticated } = useAuth();
  const { loadedOnce, settings } = useTenant();
  const [phase, setPhase] = useState('visible'); // visible → leaving → gone

  // Sin sesión basta con validar el token; con sesión, además, la marca del colegio.
  const dataReady = !initializing && (!isAuthenticated || loadedOnce);

  useEffect(() => {
    if (phase !== 'visible' || !dataReady) return undefined;
    let cancelled = false;
    Promise.race([preloadImage(isAuthenticated ? settings.logoUrl : null), new Promise((r) => setTimeout(r, MAX_WAIT_MS))]).then(() => {
      if (!cancelled) setPhase('leaving');
    });
    return () => {
      cancelled = true;
    };
  }, [phase, dataReady, isAuthenticated, settings.logoUrl]);

  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const t = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={`splash${phase === 'leaving' ? ' is-leaving' : ''}`} role="status" aria-live="polite" aria-busy={phase === 'visible'}>
      <img className="splash__logo" src={platformLogo} alt="MoDo Educa · Sistema de gestión escolar" width="1400" height="410" decoding="async" fetchpriority="high" />
      <span className="splash__bar" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export default SplashScreen;
