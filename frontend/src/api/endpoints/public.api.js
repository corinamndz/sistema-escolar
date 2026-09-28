import { axiosClient } from '../axiosClient';

/** Endpoints sin sesión. */
const publicApi = {
  /**
   * Branding público de un colegio: { slug, name, logoUrl, primaryColor, secondaryColor } (404 si no existe).
   * `Cache-Control: no-cache` en la PETICIÓN obliga al navegador a revalidar con el
   * servidor aunque tenga guardada una respuesta anterior (ej. la que antes se
   * cacheaba 5 minutos): los colores recién guardados se ven al instante.
   */
  getBranding: (slug) =>
    axiosClient
      .get(`/public/tenants/${encodeURIComponent(slug)}/branding`, { headers: { 'Cache-Control': 'no-cache' } })
      .then((r) => r.data),
};

export default publicApi;
