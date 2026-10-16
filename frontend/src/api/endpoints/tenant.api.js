import { axiosClient } from '../axiosClient';

const tenantApi = {
  getSettings: () => axiosClient.get('/tenant/settings').then((r) => r.data),
  /** Nombre, logo, colores y contacto del colegio: para cualquier usuario con sesión. */
  getProfile: () => axiosClient.get('/tenant/profile').then((r) => r.data),
  /**
   * `formData` es un FormData con los campos de texto y, opcionalmente, el
   * archivo `logo`. Hay que pisar el Content-Type JSON por defecto del
   * cliente: si no, axios serializa el FormData a JSON y el archivo se pierde.
   * Con 'multipart/form-data' el navegador agrega el boundary correcto.
   */
  updateSettings: (formData) =>
    axiosClient
      .put('/tenant/settings', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data),
  /** Grados con su escala de calificación: { grades: [{ id, name, level_name, grading_scale }], qualitative_levels, max }. */
  getGradingScales: () => axiosClient.get('/tenant/grading-scales').then((r) => r.data),
  /** [{ gradeId, gradingScale: 'quantitative' | 'qualitative' }] */
  setGradingScales: (grades) => axiosClient.put('/tenant/grading-scales', { grades }).then((r) => r.data),
  /** Datos de pago del colegio (pago móvil / cuentas bancarias). */
  listPaymentAccounts: () => axiosClient.get('/tenant/payment-accounts').then((r) => r.data),
  createPaymentAccount: (data) => axiosClient.post('/tenant/payment-accounts', data).then((r) => r.data),
  updatePaymentAccount: (id, data) => axiosClient.put(`/tenant/payment-accounts/${id}`, data).then((r) => r.data),
  deletePaymentAccount: (id) => axiosClient.delete(`/tenant/payment-accounts/${id}`).then((r) => r.data),
  /** Correo del colegio: { configured, host, port, secure, username, from_name, has_password, enabled, last_test, server_fallback } (nunca la contraseña). */
  getMailSettings: () => axiosClient.get('/tenant/mail-settings').then((r) => r.data),
  /** { host, port, secure, username, fromName, password? (vacío = conservar), enabled } */
  saveMailSettings: (data) => axiosClient.put('/tenant/mail-settings', data).then((r) => r.data),
  deleteMailSettings: () => axiosClient.delete('/tenant/mail-settings').then((r) => r.data),
  /** Envía un correo de prueba con los datos del formulario: { ok, message | error } */
  testMailSettings: (data) => axiosClient.post('/tenant/mail-settings/test', data).then((r) => r.data),
  /** «Conectar con Google»: { url } de la pantalla de consentimiento (el navegador va allí y vuelve a Configuración). */
  connectGoogleMail: (loginHint) => axiosClient.post('/tenant/mail-settings/google/connect', loginHint ? { loginHint } : {}).then((r) => r.data),
  /** { fromName?, enabled? } de la cuenta de Google conectada. */
  updateGoogleMail: (data) => axiosClient.put('/tenant/mail-settings/google', data).then((r) => r.data),
  disconnectGoogleMail: () => axiosClient.delete('/tenant/mail-settings/google').then((r) => r.data),
  testGoogleMail: (to) => axiosClient.post('/tenant/mail-settings/google/test', { to }).then((r) => r.data),
  /** Matriz de avisos: { events: [{ key, label, description, recipients, bell, email }], email: { ready, source } } */
  getNotificationPreferences: () => axiosClient.get('/tenant/notification-preferences').then((r) => r.data),
  /** { preferences: [{ event, channel: 'bell' | 'email', enabled }] } → la matriz actualizada */
  saveNotificationPreferences: (preferences) => axiosClient.put('/tenant/notification-preferences', { preferences }).then((r) => r.data),
};

export default tenantApi;
