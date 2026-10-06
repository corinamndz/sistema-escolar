import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTenant } from '../context/TenantContext';
import { buildTheme } from './palette';

const ThemePreviewContext = createContext({ setPreview: () => {} });

/**
 * Aplica la paleta del colegio a TODA la interfaz como variables CSS en
 * `:root` (ver palette.js: degradado del menú, acento, texto legible encima,
 * encabezados de tabla…). Se recalcula al instante cuando cambia la
 * configuración guardada, o mientras se edita en Configuración (`setPreview`):
 * así el cambio se ve en toda la plataforma antes de guardarlo.
 */
function ThemeProvider({ children }) {
  const { settings } = useTenant();
  const [preview, setPreview] = useState(null); // colores en edición (sin guardar)

  const theme = useMemo(
    () =>
      buildTheme({
        menuColor: settings.secondaryColor,
        accentColor: settings.primaryColor,
        menuGradient: settings.menuGradient,
        accentSecondaryColor: settings.accentSecondaryColor,
        tableHeaderStyle: settings.tableHeaderStyle,
        ...(preview || {}),
      }),
    [settings.secondaryColor, settings.primaryColor, settings.menuGradient, settings.accentSecondaryColor, settings.tableHeaderStyle, preview]
  );

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([name, value]) => root.style.setProperty(name, value));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.info.menuStart);
  }, [theme]);

  useEffect(() => {
    document.title = settings.name ? `${settings.name} · Sistema Escolar` : 'Sistema Escolar';
  }, [settings.name]);

  const value = useMemo(() => ({ setPreview }), []);
  return <ThemePreviewContext.Provider value={value}>{children}</ThemePreviewContext.Provider>;
}

/** Para Configuración: `setPreview({ accentColor, … })` muestra los colores en vivo; `setPreview(null)` vuelve a lo guardado. */
function useThemePreview() {
  return useContext(ThemePreviewContext);
}

export { ThemeProvider, useThemePreview };
