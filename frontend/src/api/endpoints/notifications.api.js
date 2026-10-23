import { axiosClient } from '../axiosClient';

const notificationsApi = {
  /**
   * Notificaciones del usuario (las de su rol): { items: [{ id, type, title, body, data, link, created_at, read }], unread_count }.
   */
  list: () => axiosClient.get('/notifications').then((r) => r.data),
  /** Conteo liviano de no leídas + las 3 más recientes: { unread_count, latest: [{ id, type, title, created_at }] }. */
  unreadCount: () => axiosClient.get('/notifications/unread-count').then((r) => r.data),
  markRead: (id) => axiosClient.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => axiosClient.post('/notifications/read-all').then((r) => r.data),
};

export default notificationsApi;
