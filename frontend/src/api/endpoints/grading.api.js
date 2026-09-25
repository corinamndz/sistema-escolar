import { axiosClient } from '../axiosClient';

const gradingApi = {
  getGradebook: (planId) => axiosClient.get(`/grading/plans/${planId}/gradebook`).then((r) => r.data),
  upsertScore: (activityId, data) => axiosClient.put(`/grading/activities/${activityId}/scores`, data).then((r) => r.data),

  assessCompetency: (competencyId, data) =>
    axiosClient.put(`/grading/competencies/${competencyId}/assessments`, data).then((r) => r.data),
  getCompetencyReport: (projectId) =>
    axiosClient.get(`/grading/projects/${projectId}/competency-report`).then((r) => r.data),
};

export default gradingApi;
