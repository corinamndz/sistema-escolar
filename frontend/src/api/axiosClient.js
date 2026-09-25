import axios from 'axios';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './tokenStore';

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  headers: { 'Content-Type': 'application/json' },
});

axiosClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** Callback que AuthContext registra para forzar el logout desde fuera de React (401 sin refresh posible). */
let onSessionExpired = () => {};
function setOnSessionExpired(callback) {
  onSessionExpired = callback;
}

let refreshPromise = null;

// Si un request falla con 401 (token expirado), intenta refrescar UNA vez y
// reintenta el request original; si el refresh también falla, cierra sesión.
axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;

    if (!response || response.status !== 401 || config._retry || config.url === '/auth/login') {
      return Promise.reject(error);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearTokens();
      onSessionExpired();
      return Promise.reject(error);
    }

    config._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = axiosClient
          .post('/auth/refresh', { refreshToken })
          .then(({ data }) => {
            setTokens({ accessToken: data.accessToken });
            return data.accessToken;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }
      const newAccessToken = await refreshPromise;
      config.headers.Authorization = `Bearer ${newAccessToken}`;
      return axiosClient(config);
    } catch (refreshError) {
      clearTokens();
      onSessionExpired();
      return Promise.reject(refreshError);
    }
  }
);

/** Extrae un mensaje legible de un error de axios (viene del error handler global del backend). */
function getErrorMessage(error) {
  return (
    error?.response?.data?.error?.message ||
    error?.message ||
    'Ocurrió un error inesperado. Intenta de nuevo.'
  );
}

/** Extrae errores de validación por campo (Zod) cuando el backend responde 400 con `details`. */
function getFieldErrors(error) {
  const details = error?.response?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  return details.reduce((acc, d) => {
    if (d.path) acc[d.path] = d.message;
    return acc;
  }, {});
}

export { axiosClient, setOnSessionExpired, getErrorMessage, getFieldErrors };
