/**
 * Guarda los tokens en localStorage (persisten al refrescar la página) y en
 * memoria (acceso síncrono rápido para el interceptor de axios). No es un
 * Context porque axiosClient.js (fuera del árbol de React) también necesita
 * leerlo/escribirlo.
 */
const ACCESS_KEY = 'school_saas_access_token';
const REFRESH_KEY = 'school_saas_refresh_token';
const USER_KEY = 'school_saas_user';

let accessToken = localStorage.getItem(ACCESS_KEY) || null;
let refreshToken = localStorage.getItem(REFRESH_KEY) || null;

function getAccessToken() {
  return accessToken;
}

function getRefreshToken() {
  return refreshToken;
}

function setTokens({ accessToken: at, refreshToken: rt }) {
  accessToken = at || null;
  refreshToken = rt !== undefined ? rt : refreshToken;

  if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  else localStorage.removeItem(ACCESS_KEY);

  if (rt !== undefined) {
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  }
}

function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export { getAccessToken, getRefreshToken, setTokens, clearTokens, getStoredUser, setStoredUser };
