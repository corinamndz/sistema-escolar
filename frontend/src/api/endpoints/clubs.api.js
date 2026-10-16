import { axiosClient } from '../axiosClient';

const clubsApi = {
  /** Clubes con inscritos del año: [{ id, name, category, is_custom, coordinator_name, member_count, capacity, is_full, … }]. */
  list: (schoolPeriodId, params = {}) => axiosClient.get('/clubs', { params: { school_period_id: schoolPeriodId, ...params } }).then((r) => r.data),
  create: (data) => axiosClient.post('/clubs', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/clubs/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/clubs/${id}`).then((r) => r.data),
  members: (clubId, schoolPeriodId) => axiosClient.get(`/clubs/${clubId}/members`, { params: { school_period_id: schoolPeriodId } }).then((r) => r.data),
  /** { clubId | customName (opción "OTRO"), studentIds, schoolPeriodId, notes? } → { club, added, already } */
  enroll: (data) => axiosClient.post('/clubs/enroll', data).then((r) => r.data),
  withdraw: (membershipId) => axiosClient.put(`/clubs/memberships/${membershipId}/withdraw`).then((r) => r.data),
  forStudent: (studentId) => axiosClient.get(`/clubs/students/${studentId}`).then((r) => r.data),
};

export default clubsApi;
