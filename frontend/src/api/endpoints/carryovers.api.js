import { axiosClient } from '../axiosClient';

const data = (r) => r.data;

/** Materias pendientes (arrastres) y sus planes especiales. */
const carryoversApi = {
  /** → { can_manage, items: [{ …, moments: [] }], candidates: [] } */
  list: () => axiosClient.get('/carryovers').then(data),
  teachers: () => axiosClient.get('/carryovers/teachers').then(data),
  /** Abre las que falten (alumnos promovidos antes de existir el módulo) → { opened } */
  sync: () => axiosClient.post('/carryovers/sync').then(data),
  assignTeacher: (id, teacherId) => axiosClient.put(`/carryovers/${id}/teacher`, { teacherId }).then(data),
  /** `moments`: los momentos aún sin calificar, en orden. */
  savePlan: (id, moments) => axiosClient.put(`/carryovers/${id}/plan`, { moments }).then(data),
  grade: (momentId, body) => axiosClient.post(`/carryovers/moments/${momentId}/grade`, body).then(data),
  cancel: (id, reason) => axiosClient.post(`/carryovers/${id}/cancel`, { reason }).then(data),
  reinstate: (id) => axiosClient.post(`/carryovers/${id}/reinstate`).then(data),
};

export default carryoversApi;
