import { axiosClient } from '../axiosClient';

/** Soporte técnico (solo el Administrador del colegio): tickets hacia la plataforma MoDo Educa. */
const supportApi = {
  options: () => axiosClient.get('/support/options').then((r) => r.data),
  /** { status? } → tickets del colegio (los más recientes primero) */
  list: (params) => axiosClient.get('/support/tickets', { params }).then((r) => r.data),
  get: (id) => axiosClient.get(`/support/tickets/${id}`).then((r) => r.data),
  /** { category, priority, subject, description, pageUrl? } + captura opcional (JPG/PNG/PDF, 5 MB) */
  create: (data, file) => {
    if (!file) return axiosClient.post('/support/tickets', data).then((r) => r.data);
    const form = new FormData();
    Object.entries(data).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && form.append(k, v));
    form.append('attachment', file);
    return axiosClient.post('/support/tickets', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  reply: (id, body) => axiosClient.post(`/support/tickets/${id}/messages`, { body }).then((r) => r.data),
  attachmentBlob: (id) => axiosClient.get(`/support/tickets/${id}/attachment`, { responseType: 'blob' }).then((r) => r.data),
};

export default supportApi;
