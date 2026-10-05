import { axiosClient } from '../axiosClient';

const gradingApi = {
  /** `params.sectionId`: filtra los alumnos de una sección del plan. */
  getGradebook: (planId, params) => axiosClient.get(`/grading/plans/${planId}/gradebook`, { params }).then((r) => r.data),
  /** Simple: { studentId, rawScore, maxScore? }. Por indicadores: { studentId, indicatorScores: [{ indicatorId, points }] }. */
  upsertScore: (activityId, data) => axiosClient.put(`/grading/activities/${activityId}/scores`, data).then((r) => r.data),

  assessCompetency: (competencyId, data) =>
    axiosClient.put(`/grading/competencies/${competencyId}/assessments`, data).then((r) => r.data),
  getCompetencyReport: (projectId) =>
    axiosClient.get(`/grading/projects/${projectId}/competency-report`).then((r) => r.data),
};

export default gradingApi;
