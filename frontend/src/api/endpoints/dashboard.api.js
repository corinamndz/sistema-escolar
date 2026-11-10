import { axiosClient } from '../axiosClient';

const dashboardApi = {
  /** KPIs y datos de los gráficos del inicio: { enrollment?, guardians?, staff?, academics?, solvency? } según permisos. */
  /** schoolPeriodId: el año elegido en la barra superior (inscritos vs. esperados). */
  summary: (params) => axiosClient.get('/dashboard/summary', { params }).then((r) => r.data),
};

export default dashboardApi;
