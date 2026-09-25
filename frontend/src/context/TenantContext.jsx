import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import tenantApi from '../api/endpoints/tenant.api';
import { useAuth } from './AuthContext';

const TenantContext = createContext(null);

const DEFAULT_SETTINGS = {
  name: 'Sistema Escolar',
  logoUrl: null,
  primaryColor: '#2563EB',
  secondaryColor: '#1E293B',
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
    } catch (err) {
      // Si el usuario no tiene permiso de leer tenant_settings, seguimos con
      // los valores por defecto en vez de romper el layout.
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
    else setSettings(DEFAULT_SETTINGS);
  }, [isAuthenticated, load]);

  const value = useMemo(() => ({ settings, loading, refreshTenant: load }), [settings, loading, load]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant debe usarse dentro de <TenantProvider>');
  return ctx;
}

export { TenantProvider, useTenant };
