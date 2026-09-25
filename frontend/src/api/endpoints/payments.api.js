import { axiosClient } from '../axiosClient';

const paymentsApi = {
  list: (params) => axiosClient.get('/payments', { params }).then((r) => r.data),
  listMine: () => axiosClient.get('/payments/mine').then((r) => r.data),
  getOne: (id) => axiosClient.get(`/payments/${id}`).then((r) => r.data),
  register: (data) => axiosClient.post('/payments', data).then((r) => r.data),
  markAsPaid: (id) => axiosClient.post(`/payments/${id}/mark-paid`).then((r) => r.data),
};

export default paymentsApi;
