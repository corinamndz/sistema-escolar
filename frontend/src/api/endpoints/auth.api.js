import { axiosClient } from '../axiosClient';

const authApi = {
  login: (data) => axiosClient.post('/auth/login', data).then((r) => r.data),
  me: () => axiosClient.get('/auth/me').then((r) => r.data),
  changePassword: (data) => axiosClient.post('/auth/change-password', data).then((r) => r.data),
  createUser: (data) => axiosClient.post('/auth/users', data).then((r) => r.data),
  // Recuperación de contraseña (públicas): { tenantSlug, email } · { tenantSlug, token } · { tenantSlug, token, newPassword }
  forgotPassword: (data) => axiosClient.post('/auth/forgot-password', data).then((r) => r.data),
  verifyResetToken: (data) => axiosClient.post('/auth/reset-password/verify', data).then((r) => r.data),
  resetPassword: (data) => axiosClient.post('/auth/reset-password', data).then((r) => r.data),
};

export default authApi;
