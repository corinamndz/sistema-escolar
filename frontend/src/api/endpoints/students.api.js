import { axiosClient } from '../axiosClient';

const studentsApi = {
  list: (params) => axiosClient.get('/students', { params }).then((r) => r.data),
  getOne: (id) => axiosClient.get(`/students/${id}`).then((r) => r.data),
  create: (data) => axiosClient.post('/students', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/students/${id}`, data).then((r) => r.data),
  linkGuardian: (id, data) => axiosClient.post(`/students/${id}/guardians`, data).then((r) => r.data),
  unlinkGuardian: (id, guardianId) =>
    axiosClient.delete(`/students/${id}/guardians/${guardianId}`).then((r) => r.data),

  listGuardians: () => axiosClient.get('/guardians').then((r) => r.data),
  getGuardian: (id) => axiosClient.get(`/guardians/${id}`).then((r) => r.data),
  createGuardian: (data) => axiosClient.post('/guardians', data).then((r) => r.data),
  updateGuardian: (id, data) => axiosClient.put(`/guardians/${id}`, data).then((r) => r.data),
  deleteGuardian: (id) => axiosClient.delete(`/guardians/${id}`).then((r) => r.data),
};

export default studentsApi;
