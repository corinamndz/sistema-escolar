import { useEffect } from 'react';
import { useTenant } from '../context/TenantContext';

const DEFAULT_PRIMARY = '#2563EB';
const DEFAULT_SECONDARY = '#0F172A';

/** Normaliza `#abc` / `#aabbcc` a `[r, g, b]`; devuelve null si el valor no es un hex válido. */
function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Luminancia relativa WCAG, para decidir si el texto sobre el color va en blanco o en oscuro. */
function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Inyecta los colores del tenant como variables CSS en `:root`, para que
 * todo el UI (botones, links activos, acentos del sidebar) se adapte sin
 * duplicar hojas de estilo por colegio. Los tonos derivados (hover, fondos
 * traslúcidos, anillos de foco) se calculan en index.css con color-mix(),
 * así que aquí solo hace falta publicar los dos colores base, su versión
 * RGB y un color de texto legible encima de cada uno.
 */
function ThemeProvider({ children }) {
  const { settings } = useTenant();

  useEffect(() => {
    const root = document.documentElement;
    const primary = hexToRgb(settings.primaryColor) ? settings.primaryColor : DEFAULT_PRIMARY;
    const secondary = hexToRgb(settings.secondaryColor) ? settings.secondaryColor : DEFAULT_SECONDARY;
    const primaryRgb = hexToRgb(primary);
    const secondaryRgb = hexToRgb(secondary);

    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-primary-rgb', primaryRgb.join(', '));
    root.style.setProperty('--color-on-primary', luminance(primaryRgb) > 0.45 ? '#0f172a' : '#ffffff');
    root.style.setProperty('--color-secondary', secondary);
    // Un sidebar con color secundario claro necesita texto oscuro para seguir siendo legible.
    root.style.setProperty('--sidebar-fg-rgb', luminance(secondaryRgb) > 0.45 ? '15, 23, 42' : '248, 250, 252');

    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', secondary);
  }, [settings.primaryColor, settings.secondaryColor]);

  useEffect(() => {
    document.title = settings.name ? `${settings.name} · Sistema Escolar` : 'Sistema Escolar';
  }, [settings.name]);

  return children;
}

export { ThemeProvider };
