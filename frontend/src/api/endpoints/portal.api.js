import { axiosClient } from '../axiosClient';

const portalApi = {
  /** Panel del representante autenticado: { guardian, students, totals } (guardian null si no es representante). */
  getMine: () => axiosClient.get('/portal/me').then((r) => r.data),
  /** Calificaciones acumuladas de un alumno del representante (404 si no es su representado). */
  getStudentGrades: (studentId, params) =>
    axiosClient.get(`/portal/students/${studentId}/grades`, { params }).then((r) => r.data),
};

export default portalApi;
