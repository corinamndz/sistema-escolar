import { axiosClient } from '../axiosClient';

/** Convivencia: sanciones disciplinarias de los alumnos. */
const disciplineApi = {
  /** { schoolPeriodId?, severity?, q? } → { items, totals } (docente: solo alumnos de su carga). */
  list: (params) => axiosClient.get('/discipline/sanctions', { params }).then((r) => r.data),
  /** Historial del alumno → { student, items, totals }. */
  forStudent: (studentId) => axiosClient.get(`/discipline/students/${studentId}/sanctions`).then((r) => r.data),
  /** { severity, faultType, description, measure?, occurredOn, schoolPeriodId?, termNumber? } */
  create: (studentId, data) => axiosClient.post(`/discipline/students/${studentId}/sanctions`, data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/discipline/sanctions/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/discipline/sanctions/${id}`).then((r) => r.data),
};

export default disciplineApi;
