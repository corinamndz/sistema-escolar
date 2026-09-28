import { axiosClient } from '../axiosClient';

const evaluationPlansApi = {
  listTerms: (schoolPeriodId) =>
    axiosClient.get('/evaluation-plans/terms', { params: { schoolPeriodId } }).then((r) => r.data),
  createTerm: (data) => axiosClient.post('/evaluation-plans/terms', data).then((r) => r.data),

  list: (params) => axiosClient.get('/evaluation-plans', { params }).then((r) => r.data),
  getOne: (id) => axiosClient.get(`/evaluation-plans/${id}`).then((r) => r.data),
  create: (data) => axiosClient.post('/evaluation-plans', data).then((r) => r.data),

  createProject: (planId, data) => axiosClient.post(`/evaluation-plans/${planId}/project`, data).then((r) => r.data),
  addCompetency: (projectId, data) =>
    axiosClient.post(`/evaluation-plans/projects/${projectId}/competencies`, data).then((r) => r.data),

  createActivity: (planId, data) => axiosClient.post(`/evaluation-plans/${planId}/activities`, data).then((r) => r.data),
  updateActivity: (planId, activityId, data) =>
    axiosClient.put(`/evaluation-plans/${planId}/activities/${activityId}`, data).then((r) => r.data),
  deleteActivity: (planId, activityId) =>
    axiosClient.delete(`/evaluation-plans/${planId}/activities/${activityId}`).then((r) => r.data),

  /** Cierra el plan (exige que las actividades sumen exactamente 100%) / lo reabre. */
  close: (planId) => axiosClient.post(`/evaluation-plans/${planId}/close`).then((r) => r.data),
  reopen: (planId) => axiosClient.post(`/evaluation-plans/${planId}/reopen`).then((r) => r.data),
};

export default evaluationPlansApi;
