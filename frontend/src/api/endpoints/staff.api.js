import { axiosClient } from '../axiosClient';

const staffApi = {
  list: (params) => axiosClient.get('/staff', { params }).then((r) => r.data),
  getOne: (id) => axiosClient.get(`/staff/${id}`).then((r) => r.data),
  create: (data) => axiosClient.post('/staff', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/staff/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/staff/${id}`).then((r) => r.data),

  /** Roles que el usuario puede asignar al personal (el coordinador: solo los de menor jerarquía). */
  assignableRoles: () => axiosClient.get('/staff/access/roles').then((r) => r.data),
  /** Usuario de acceso del empleado: { access: { id, username, status, last_login_at, roles } | null } */
  getAccess: (id) => axiosClient.get(`/staff/${id}/access`).then((r) => r.data),
  /** { email, roleIds, password?, coordinationLevel? } → { access, temporaryPassword } */
  createAccess: (id, data) => axiosClient.post(`/staff/${id}/access`, data).then((r) => r.data),
  /** { email?, roleIds?, status?, resetPassword?, password?, coordinationLevel? } → { access, temporaryPassword } */
  updateAccess: (id, data) => axiosClient.put(`/staff/${id}/access`, data).then((r) => r.data),
};

export default staffApi;
