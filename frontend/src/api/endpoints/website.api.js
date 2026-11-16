import { axiosClient } from '../axiosClient';

const data = (r) => r.data;

/** Mini-sitio web del colegio. El editor es solo del Administrador; `getPublic` no requiere sesión. */
const websiteApi = {
  /** { site, school, slug: { current, custom, default }, limits } */
  get: () => axiosClient.get('/website').then(data),
  save: (site) => axiosClient.put('/website', site).then(data),
  setPublished: (published) => axiosClient.put('/website/publish', { published }).then(data),
  /** Sube una imagen (portada o galería) → { url }. Queda en uso al guardar el sitio. */
  uploadImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return axiosClient
      .post('/website/images', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(data);
  },
  /** Logo OFICIAL del colegio (el mismo de Configuración), PNG o JPG → el editor actualizado. */
  uploadLogo: (file) => {
    const form = new FormData();
    form.append('logo', file);
    return axiosClient.post('/website/logo', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(data);
  },
  /** Página pública: { slug, school, site } (404 si no existe o no está publicada). */
  getPublic: (slug) => axiosClient.get(`/public/sites/${encodeURIComponent(slug)}`).then(data),
  /** Solicitud de cupo pública: { title, description, school_period_name, fields } (404 si no está habilitada). */
  getIntake: (slug) => axiosClient.get(`/public/sites/${encodeURIComponent(slug)}/intake`).then(data),
  /** { applicantName, answers, contact: { name, national_id, phone, email }, website (trampa), elapsed_ms } */
  submitIntake: (slug, body) => axiosClient.post(`/public/sites/${encodeURIComponent(slug)}/intake`, body).then(data),
};

export default websiteApi;
