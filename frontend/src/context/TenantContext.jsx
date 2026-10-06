import { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import tenantApi from '../api/endpoints/tenant.api';
import { useAuth } from './AuthContext';

const TenantContext = createContext(null);

const DEFAULT_SETTINGS = {
  name: 'Sistema Escolar',
  logoUrl: null,
  primaryColor: '#2563EB',
  secondaryColor: '#1E293B',
  menuGradient: 'deep',
  accentSecondaryColor: null,
  tableHeaderStyle: 'subtle',
  contactPhone: null,
  contactEmail: null,
};

/**
 * El backend devuelve los logos subidos como ruta relativa (`/storage/logos/...`).
 * En desarrollo el proxy de Vite la resuelve; en producción el API puede estar
 * en otro dominio (VITE_API_URL), así que se antepone. URLs absolutas quedan igual.
 */
function resolveAssetUrl(url) {
  if (!url || !url.startsWith('/')) return url;
  return `${import.meta.env.VITE_API_URL || ''}${url}`;
}

function TenantProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tenantApi.getSettings();
      setSettings({ ...data, logoUrl: resolveAssetUrl(data.logoUrl) });
    } catch {
      // Sin permiso de Configuración (docentes, familias): el perfil del colegio
      // trae lo mismo que necesita el diseño (nombre, logo, colores, contacto).
      try {
        const profile = await tenantApi.getProfile();
        setSettings({ ...DEFAULT_SETTINGS, ...profile, logoUrl: resolveAssetUrl(profile.logoUrl) });
      } catch {
        setSettings(DEFAULT_SETTINGS); // sin romper el layout
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Solo se vuelve a los valores por defecto al CERRAR sesión. Al montar sin
  // sesión no se toca nada: los efectos de los hijos (el login) corren antes que
  // este, y un reset aquí pisaría la marca que el login acaba de aplicar.
  const authRef = useRef(isAuthenticated);
  useEffect(() => {
    const wasAuthenticated = authRef.current;
    authRef.current = isAuthenticated;
    if (isAuthenticated) load();
    else if (wasAuthenticated) setSettings(DEFAULT_SETTINGS);
  }, [isAuthenticated, load]);

  // Al volver a la pestaña se relee la configuración (máx. cada 30 s): si la
  // administración cambió el contacto o los colores, se ve sin recargar.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > 30000) {
        last = Date.now();
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isAuthenticated, load]);

  /**
   * Marca pública del colegio (GET /public/tenants/:slug/branding) para pintar
   * el login antes de autenticarse; `null` vuelve a la marca genérica. Con
   * sesión iniciada se ignora: manda la configuración completa del colegio.
   */
  const applyBranding = useCallback((branding) => {
    if (authRef.current) return;
    setSettings(
      branding
        ? {
            ...DEFAULT_SETTINGS,
            name: branding.name,
            logoUrl: resolveAssetUrl(branding.logoUrl),
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            menuGradient: branding.menuGradient,
            accentSecondaryColor: branding.accentSecondaryColor,
            tableHeaderStyle: branding.tableHeaderStyle,
          }
        : DEFAULT_SETTINGS
    );
  }, []);

  const value = useMemo(
    () => ({ settings, loading, refreshTenant: load, applyBranding }),
    [settings, loading, load, applyBranding]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant debe usarse dentro de <TenantProvider>');
  return ctx;
}

export { TenantProvider, useTenant };
