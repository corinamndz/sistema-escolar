import { axiosClient } from '../axiosClient';

const notificationLogApi = {
  /** Historial de envíos (campana, avisos por correo y correos directos). `days`: 30 | 90 | 365 | 'all'. */
  list: (days) => axiosClient.get('/notifications/log', { params: { days } }).then((r) => r.data),
  /** Reenvía un registro: `source` = 'bell' | 'outbox' | 'mail'. Devuelve { ok, message }. */
  resend: (source, id) => axiosClient.post(`/notifications/log/${source}/${id}/resend`).then((r) => r.data),
};

export default notificationLogApi;
