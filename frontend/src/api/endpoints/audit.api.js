import { axiosClient } from '../axiosClient';

const get = (url, params) => axiosClient.get(url, { params }).then((r) => r.data);

/** Bitácora de auditoría (solo Administrador). */
const auditApi = {
  /** `{ from?, to?, module?, userId?, action?, q? }` → { items, has_more, limit } */
  list: (params) => get('/audit', params),
  getOne: (id) => get(`/audit/${id}`),
  /** Valores para los filtros: { modules, users, actions } */
  options: () => get('/audit/options'),
};

export default auditApi;
