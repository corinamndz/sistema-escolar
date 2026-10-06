import { axiosClient } from '../axiosClient';

const tenantApi = {
  getSettings: () => axiosClient.get('/tenant/settings').then((r) => r.data),
  /** Nombre, logo, colores y contacto del colegio: para cualquier usuario con sesión. */
  getProfile: () => axiosClient.get('/tenant/profile').then((r) => r.data),
  /**
   * `formData` es un FormData con los campos de texto y, opcionalmente, el
   * archivo `logo`. Hay que pisar el Content-Type JSON por defecto del
   * cliente: si no, axios serializa el FormData a JSON y el archivo se pierde.
   * Con 'multipart/form-data' el navegador agrega el boundary correcto.
   */
  updateSettings: (formData) =>
    axiosClient
      .put('/tenant/settings', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data),
};

export default tenantApi;
