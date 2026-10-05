import { axiosClient } from '../axiosClient';
import { registerCurrencies } from '../../features/payments/currency';

const portalApi = {
  /** Panel del representante autenticado: { guardian, students, totals } (guardian null si no es representante). */
  /** `currency`: moneda en que se totaliza lo pendiente (por defecto la del colegio). */
  getMine: (params) =>
    axiosClient.get('/portal/me', { params }).then((r) => {
      registerCurrencies(r.data?.exchange?.currencies);
      return r.data;
    }),
  /** Calificaciones acumuladas de un alumno del representante (404 si no es su representado). */
  getStudentGrades: (studentId, params) =>
    axiosClient.get(`/portal/students/${studentId}/grades`, { params }).then((r) => r.data),
};

export default portalApi;
