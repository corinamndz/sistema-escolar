import { axiosClient } from '../axiosClient';

const staffApi = {
  list: (params) => axiosClient.get('/staff', { params }).then((r) => r.data),
  getOne: (id) => axiosClient.get(`/staff/${id}`).then((r) => r.data),
  create: (data) => axiosClient.post('/staff', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/staff/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/staff/${id}`).then((r) => r.data),
};

export default staffApi;
