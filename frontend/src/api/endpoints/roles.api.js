import { axiosClient } from '../axiosClient';

const rolesApi = {
  listModules: () => axiosClient.get('/roles/modules').then((r) => r.data),
  list: () => axiosClient.get('/roles').then((r) => r.data),
  getOne: (id) => axiosClient.get(`/roles/${id}`).then((r) => r.data),
  create: (data) => axiosClient.post('/roles', data).then((r) => r.data),
  rename: (id, data) => axiosClient.put(`/roles/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/roles/${id}`).then((r) => r.data),
  setPermissions: (id, permissions) =>
    axiosClient.put(`/roles/${id}/permissions`, { permissions }).then((r) => r.data),
};

export default rolesApi;
