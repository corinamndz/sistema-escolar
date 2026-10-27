import { axiosClient } from '../axiosClient';

const recognitionsApi = {
  /** { studentId?, category?, q? } → reconocimientos (docente: solo de sus alumnos) */
  list: (params) => axiosClient.get('/recognitions', { params }).then((r) => r.data),
  /** { categories: [{ key, label, icon }], students: [{ id, name, grade_name, section_name }] } */
  options: () => axiosClient.get('/recognitions/options').then((r) => r.data),
  /** { studentId, category, title, message, awardedOn } → el reconocimiento (con `notified`) */
  create: (data) => axiosClient.post('/recognitions', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/recognitions/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/recognitions/${id}`).then((r) => r.data),
  /** Certificado en PDF (Blob). */
  certificateBlob: (id) => axiosClient.get(`/recognitions/${id}/certificate`, { responseType: 'blob' }).then((r) => r.data),
};

export default recognitionsApi;
