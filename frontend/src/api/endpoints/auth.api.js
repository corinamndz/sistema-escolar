import { axiosClient } from '../axiosClient';

const authApi = {
  login: (data) => axiosClient.post('/auth/login', data).then((r) => r.data),
  me: () => axiosClient.get('/auth/me').then((r) => r.data),
  changePassword: (data) => axiosClient.post('/auth/change-password', data).then((r) => r.data),
  createUser: (data) => axiosClient.post('/auth/users', data).then((r) => r.data),
};

export default authApi;
