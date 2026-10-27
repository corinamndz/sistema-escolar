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
  /** Reconocimientos del alumno (logros otorgados por el colegio). */
  getStudentRecognitions: (studentId) => axiosClient.get(`/portal/students/${studentId}/recognitions`).then((r) => r.data),
  /** Certificado en PDF de un reconocimiento del alumno (Blob). */
  getRecognitionCertificateBlob: (studentId, id) =>
    axiosClient.get(`/portal/students/${studentId}/recognitions/${id}/certificate`, { responseType: 'blob' }).then((r) => r.data),
  /** Horario semanal (solo lectura) de la sección del alumno. */
  getStudentSchedule: (studentId) => axiosClient.get(`/portal/students/${studentId}/schedule`).then((r) => r.data),
  /** Clubes y actividades extracurriculares del alumno (404 si no es su representado). */
  /** Cartelera de eventos del colegio para la familia (todo el colegio + grado/sección de sus hijos). */
  getEvents: (params = {}) => axiosClient.get('/portal/events', { params }).then((r) => r.data),
  getStudentClubs: (studentId) => axiosClient.get(`/portal/students/${studentId}/clubs`).then((r) => r.data),
  /** Cronograma de evaluaciones de la sección del alumno (404 si no es su representado). */
  getStudentEvaluations: (studentId, termNumber) =>
    axiosClient.get(`/portal/students/${studentId}/evaluations`, { params: { term_number: termNumber || undefined } }).then((r) => r.data),
  /** Historial académico de un alumno del representante. */
  getStudentHistory: (studentId) => axiosClient.get(`/portal/students/${studentId}/history`).then((r) => r.data),
  getStudentGrades: (studentId, params) =>
    axiosClient.get(`/portal/students/${studentId}/grades`, { params }).then((r) => r.data),
  /** Plan de evaluación completo (solo lectura) de una materia del alumno. */
  /** Contenido programático de la materia con sus evaluaciones publicadas en la sección del alumno. */
  getStudentSubjectProgram: (studentId, subjectId, params) =>
    axiosClient.get(`/portal/students/${studentId}/subjects/${subjectId}/program`, { params }).then((r) => r.data),
  getStudentPlanDetail: (studentId, planId) => axiosClient.get(`/portal/students/${studentId}/evaluation-plans/${planId}`).then((r) => r.data),
  /** Datos de pago del colegio (pago móvil y cuentas) para reportar un pago: solo los activos. */
  getPaymentAccounts: () => axiosClient.get('/portal/payment-accounts').then((r) => r.data),
};

export default portalApi;
