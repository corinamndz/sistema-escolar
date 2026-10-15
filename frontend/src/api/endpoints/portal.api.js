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
  /** Historial disciplinario (sanciones) del alumno: { student, items, totals }. */
  getStudentSanctions: (studentId) => axiosClient.get(`/portal/students/${studentId}/sanctions`).then((r) => r.data),
  /** Horario semanal (solo lectura) de la sección del alumno. */
  getStudentSchedule: (studentId) => axiosClient.get(`/portal/students/${studentId}/schedule`).then((r) => r.data),
  /** Cronograma de evaluaciones de la sección del alumno (404 si no es su representado). */
  getStudentEvaluations: (studentId, termNumber) =>
    axiosClient.get(`/portal/students/${studentId}/evaluations`, { params: { term_number: termNumber || undefined } }).then((r) => r.data),
  /** Historial académico de un alumno del representante. */
  getStudentHistory: (studentId) => axiosClient.get(`/portal/students/${studentId}/history`).then((r) => r.data),
  getStudentGrades: (studentId, params) =>
    axiosClient.get(`/portal/students/${studentId}/grades`, { params }).then((r) => r.data),
  /** Datos de pago del colegio (pago móvil y cuentas) para reportar un pago: solo los activos. */
  getPaymentAccounts: () => axiosClient.get('/portal/payment-accounts').then((r) => r.data),
};

export default portalApi;
