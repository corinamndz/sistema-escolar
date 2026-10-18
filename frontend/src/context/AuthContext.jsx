import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import authApi from '../api/endpoints/auth.api';
import { setOnSessionExpired } from '../api/axiosClient';
import {
  getAccessToken,
  setTokens,
  clearTokens,
  getStoredUser,
  setStoredUser,
  persistSessionFor,
  SESSION_NAMESPACE,
} from '../api/tokenStore';
import { normalizeSlug, rememberTenantSlug } from '../lib/tenantSlug';
import { tenantUrl } from '../lib/tenantPath';

/** ¿La sesión pertenece al colegio de esta página? ('_' = login genérico: ninguno) */
const belongsHere = (slug) => normalizeSlug(slug) === SESSION_NAMESPACE;

const AuthContext = createContext(null);

const CRUD_ACTIONS = ['create', 'read', 'update', 'delete'];

function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [permissions, setPermissions] = useState({});
  const [initializing, setInitializing] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const me = await authApi.me();
      // Defensa: una sesión guardada bajo este colegio debe ser de este colegio.
      if (!belongsHere(me.tenantSlug)) throw new Error('La sesión guardada es de otro colegio.');
      rememberTenantSlug(me.tenantSlug); // "/" a secas abre el último colegio usado
      setUser(me);
      setStoredUser(me);
      setPermissions(me.permissions || {});
    } catch (err) {
      clearTokens();
      setUser(null);
      setPermissions({});
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    if (getAccessToken()) {
      loadMe();
    } else {
      setInitializing(false);
    }
  }, [loadMe]);

  useEffect(() => {
    // Si axiosClient no puede refrescar el token (401 + refresh falla), cae aquí.
    setOnSessionExpired(() => {
      setUser(null);
      setPermissions({});
    });
  }, []);

  const login = useCallback(async ({ tenantSlug, username, password }) => {
    const result = await authApi.login({ tenantSlug, username, password });
    rememberTenantSlug(result.user.tenantSlug);

    // Se inició sesión en un colegio distinto al de esta página (login genérico,
    // o "Cambiar" colegio): la sesión se guarda bajo SU colegio y se abre su URL.
    // Esta página no se toca: la sesión que tuviera aquí sigue intacta.
    if (!belongsHere(result.user.tenantSlug)) {
      persistSessionFor(result.user.tenantSlug, result);
      window.location.assign(tenantUrl(result.user.tenantSlug, '/'));
      return { ...result, redirecting: true };
    }

    setTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
    setUser(result.user);
    setStoredUser(result.user);
    await loadMe(); // trae permisos completos (login no los devuelve)
    return result;
  }, [loadMe]);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    setPermissions({});
  }, []);

  /** `can('students', 'update')` — usado por el Sidebar y para ocultar botones de acción. */
  const can = useCallback(
    (moduleCode, action) => {
      const modulePerm = permissions[moduleCode];
      if (!modulePerm) return false;
      return CRUD_ACTIONS.includes(action)
        ? Boolean(modulePerm[`can_${action}`])
        : modulePerm.extra_actions?.[action] === true;
    },
    [permissions]
  );

  const value = useMemo(
    () => ({
      user,
      permissions,
      isAuthenticated: Boolean(user),
      mustChangePassword: Boolean(user?.mustChangePassword),
      initializing,
      login,
      logout,
      can,
      refreshUser: loadMe,
    }),
    [user, permissions, initializing, login, logout, can, loadMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

export { AuthProvider, useAuth };
