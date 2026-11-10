import { axiosClient } from '../axiosClient';

const notificationsApi = {
  /**
   * Notificaciones del usuario (las de su rol): { items: [{ id, type, title, body, data, link, created_at, read }], unread_count }.
   */
  list: () => axiosClient.get('/notifications').then((r) => r.data),
  /** Conteo liviano de no leídas + las 3 más recientes: { unread_count, latest: [{ id, type, title, created_at }] }. */
  unreadCount: () => axiosClient.get('/notifications/unread-count').then((r) => r.data),
  /**
   * Centro de notificaciones: historial completo, paginado.
   * params: { status: 'all'|'unread'|'read', from?, to? ('YYYY-MM-DD'), type?, page, pageSize }
   * → { items, total, page, page_size, unread_count, types }
   */
  history: (params) => axiosClient.get('/notifications/history', { params }).then((r) => r.data),
  /** Trazabilidad de lectura (Administración): { notification, stats, recipients } */
  audit: (id) => axiosClient.get(`/notifications/${id}/audit`).then((r) => r.data),
  markRead: (id) => axiosClient.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => axiosClient.post('/notifications/read-all').then((r) => r.data),

  // ---- Comunicados de la administración ----
  /** { categories, levels, grades, sections, guardians, staff } para armar el alcance. */
  broadcastOptions: () => axiosClient.get('/notifications/broadcast/options').then((r) => r.data),
  /** Alcance → { total, by_group, without_access, scope_label, sample } (no envía nada). */
  broadcastPreview: (scope) => axiosClient.post('/notifications/broadcast/preview', scope).then((r) => r.data),
  /** { title, category, html, scope, levelCodes?, gradeIds?, sectionIds?, guardianIds?, staffIds?, groups } → { id, recipients, scope_label } */
  broadcast: (data) => axiosClient.post('/notifications/broadcast', data).then((r) => r.data),
  /** Sube una imagen para el mensaje (PNG, JPG, GIF o WebP, hasta 3 MB) → { url } */
  uploadBroadcastImage: (file) => {
    const form = new FormData();
    form.append('image', file);
    return axiosClient.post('/notifications/broadcast/images', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
  },
  /** Comunicados enviados con destinatarios y lecturas. */
  broadcastHistory: () => axiosClient.get('/notifications/broadcast').then((r) => r.data),
  /** Log de lectura de un comunicado: { notification, stats, recipients: [{ name, roles, area, students, status, read_at }] }. */
  broadcastReads: (id) => axiosClient.get(`/notifications/broadcast/${id}/reads`).then((r) => r.data),
};

export default notificationsApi;
