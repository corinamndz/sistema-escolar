import { axiosClient } from '../axiosClient';

const dashboardApi = {
  /** KPIs y datos de los gráficos del inicio: { enrollment?, guardians?, staff?, academics?, solvency? } según permisos. */
  summary: () => axiosClient.get('/dashboard/summary').then((r) => r.data),
};

export default dashboardApi;
