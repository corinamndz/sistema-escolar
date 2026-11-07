import { axiosClient } from '../axiosClient';

const gradingApi = {
  /** `params.sectionId`: filtra los alumnos de una sección del plan. */
  getGradebook: (planId, params) => axiosClient.get(`/grading/plans/${planId}/gradebook`, { params }).then((r) => r.data),
  /** Simple: { studentId, rawScore, maxScore? }. Por indicadores: { studentId, indicatorScores: [{ indicatorId, points }] }. */
  upsertScore: (activityId, data) => axiosClient.put(`/grading/activities/${activityId}/scores`, data).then((r) => r.data),

  assessCompetency: (competencyId, data) =>
    axiosClient.put(`/grading/competencies/${competencyId}/assessments`, data).then((r) => r.data),
  /** Resumen del colegio: cada alumno con su acumulado por lapso y su boleta por materia. */
  getSummary: (schoolPeriodId) => axiosClient.get('/grading/summary', { params: { schoolPeriodId: schoolPeriodId || undefined } }).then((r) => r.data),
  /** Desglose de un alumno en un año: notas por materia y lapso, definitiva y estado (aprobada / reprobada). */
  getStudentDetail: (studentId, schoolPeriodId) =>
    axiosClient.get(`/grading/summary/students/${studentId}`, { params: { schoolPeriodId: schoolPeriodId || undefined } }).then((r) => r.data),
  getCompetencyReport: (projectId) =>
    axiosClient.get(`/grading/projects/${projectId}/competency-report`).then((r) => r.data),
};

export default gradingApi;
