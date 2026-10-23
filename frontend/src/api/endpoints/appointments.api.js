import { axiosClient } from '../axiosClient';

const appointmentsApi = {
  /** Citas con padres (`{ from, to, status }` opcionales). El docente recibe solo las de sus alumnos. */
  list: (params) => axiosClient.get('/appointments', { params }).then((r) => r.data),
  /** { guardians: [{ id, first_name, last_name, national_id, email, has_portal, students: [{ id, name }] }], notify_defaults, email_ready, statuses } */
  options: () => axiosClient.get('/appointments/options').then((r) => r.data),
  get: (id) => axiosClient.get(`/appointments/${id}`).then((r) => r.data),
  /** Devuelve la cita con `notified: { bell, emails }` (qué aviso se envió). */
  create: (data) => axiosClient.post('/appointments', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/appointments/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/appointments/${id}`).then((r) => r.data),
  /** "Reenviar aviso": vuelve a avisar al representante. → cita con `notified: { bell, emails }` y `last_notified_at`. */
  resend: (id) => axiosClient.post(`/appointments/${id}/resend`).then((r) => r.data),

  // ---- Portal del representante ----
  /** Citas próximas de la familia (pendientes primero). */
  mine: () => axiosClient.get('/portal/appointments').then((r) => r.data),
  /** El representante confirma su asistencia → cita confirmada. */
  confirmMine: (id) => axiosClient.post(`/portal/appointments/${id}/confirm`).then((r) => r.data),
};

export default appointmentsApi;
