/**
 * Sesión del usuario, AISLADA POR COLEGIO.
 *
 * Los tokens se guardan en localStorage (persisten al refrescar) bajo claves
 * con el colegio como prefijo:
 *
 *   school_saas:<slug>:access_token
 *   school_saas:<slug>:refresh_token
 *   school_saas:<slug>:user
 *
 * Así /demo y /colegio-araguaney pueden tener cada uno su sesión abierta en el
 * mismo navegador sin pisarse. El colegio de esta página se fija al cargar
 * (lib/tenantPath.js). También se mantienen en memoria para el acceso
 * síncrono del interceptor de axios. No es un Context porque axiosClient.js
 * (fuera del árbol de React) también necesita leerlo/escribirlo.
 */
import { PATH_TENANT } from '../lib/tenantPath';
import { isValidSlug, normalizeSlug, resolveTenantSlug } from '../lib/tenantSlug';

const PREFIX = 'school_saas';
const keysFor = (namespace) => ({
  access: `${PREFIX}:${namespace}:access_token`,
  refresh: `${PREFIX}:${namespace}:refresh_token`,
  user: `${PREFIX}:${namespace}:user`,
});

/** Colegio dueño de la sesión de esta página: el de la ruta, o el del subdominio. */
function currentNamespace() {
  if (PATH_TENANT) return PATH_TENANT;
  const { slug, source } = resolveTenantSlug();
  return source === 'subdomain' ? slug : '_'; // '_' = login genérico, sin colegio
}

export const SESSION_NAMESPACE = currentNamespace();
const KEYS = keysFor(SESSION_NAMESPACE);

// localStorage puede no estar disponible (modo privado estricto, bloqueado).
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // sin almacenamiento: la sesión dura lo que la pestaña
    }
  },
};

/**
 * Sesión guardada con el formato anterior (claves sin colegio): se mueve al
 * colegio al que pertenece, para no cerrarle la sesión a nadie al actualizar.
 */
function migrateLegacySession() {
  const legacy = { access: 'school_saas_access_token', refresh: 'school_saas_refresh_token', user: 'school_saas_user' };
  const access = storage.get(legacy.access);
  if (access) {
    let slug = null;
    try {
      slug = normalizeSlug(JSON.parse(storage.get(legacy.user) || 'null')?.tenantSlug);
    } catch {
      slug = null;
    }
    const target = isValidSlug(slug) ? keysFor(slug) : null;
    if (target && !storage.get(target.access)) {
      storage.set(target.access, access);
      storage.set(target.refresh, storage.get(legacy.refresh));
      storage.set(target.user, storage.get(legacy.user));
    }
  }
  Object.values(legacy).forEach((key) => storage.set(key, null));
}
migrateLegacySession();

let accessToken = storage.get(KEYS.access) || null;
let refreshToken = storage.get(KEYS.refresh) || null;

function getAccessToken() {
  return accessToken;
}

function getRefreshToken() {
  return refreshToken;
}

function setTokens({ accessToken: at, refreshToken: rt }) {
  accessToken = at || null;
  refreshToken = rt !== undefined ? rt : refreshToken;
  storage.set(KEYS.access, accessToken);
  if (rt !== undefined) storage.set(KEYS.refresh, refreshToken);
}

/** Cierra la sesión SOLO de este colegio. */
function clearTokens() {
  accessToken = null;
  refreshToken = null;
  Object.values(KEYS).forEach((key) => storage.set(key, null));
}

function getStoredUser() {
  try {
    return JSON.parse(storage.get(KEYS.user) || 'null');
  } catch {
    return null;
  }
}

function setStoredUser(user) {
  storage.set(KEYS.user, user ? JSON.stringify(user) : null);
}

/**
 * Guarda una sesión para OTRO colegio (se inició sesión desde un login que no
 * era el suyo); la página que se abra en /<slug> la encontrará.
 */
function persistSessionFor(slug, { accessToken: at, refreshToken: rt, user }) {
  const keys = keysFor(normalizeSlug(slug));
  storage.set(keys.access, at);
  storage.set(keys.refresh, rt);
  storage.set(keys.user, user ? JSON.stringify(user) : null);
}

export { getAccessToken, getRefreshToken, setTokens, clearTokens, getStoredUser, setStoredUser, persistSessionFor };
