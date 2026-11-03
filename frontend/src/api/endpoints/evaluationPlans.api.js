import { axiosClient } from '../axiosClient';
import { fileNameFrom, saveBlob, unwrapBlobError, upload } from './imports.api';

const evaluationPlansApi = {
  listTerms: (schoolPeriodId) =>
    axiosClient.get('/evaluation-plans/terms', { params: { schoolPeriodId } }).then((r) => r.data),
  createTerm: (data) => axiosClient.post('/evaluation-plans/terms', data).then((r) => r.data),

  // Opciones para crear planes: el docente recibe solo lo de su carga del período activo.
  listPeriodOptions: () => axiosClient.get('/evaluation-plans/options/school-periods').then((r) => r.data),
  listSectionOptions: () => axiosClient.get('/evaluation-plans/options/sections').then((r) => r.data),
  getSectionAssignment: (sectionId) => axiosClient.get(`/evaluation-plans/options/sections/${sectionId}/assignment`).then((r) => r.data),

  list: (params) => axiosClient.get('/evaluation-plans', { params }).then((r) => r.data),
  getOne: (id) => axiosClient.get(`/evaluation-plans/${id}`).then((r) => r.data),
  /** Confirmaciones de lectura de los representantes: { plan, published, totals, items } */
  listAcknowledgments: (id) => axiosClient.get(`/evaluation-plans/${id}/acknowledgments`).then((r) => r.data),
  /** { sectionIds: [...] (o sectionId), termId, format: 'simple' | 'detailed', subjectId | subject + teacherId } */
  create: (data) => axiosClient.post('/evaluation-plans', data).then((r) => r.data),
  /** 409 si tiene notas o constancias de lectura de las familias. → { subject, grade_name, term_name, deleted_activities } */
  remove: (id) => axiosClient.delete(`/evaluation-plans/${id}`).then((r) => r.data),
  /** Copia el plan (sin notas) a otro año: → { plan_id, period, term_name, sections, missing_sections, teacher_name, activities, topics_created } */
  duplicate: (planId, toPeriodId) => axiosClient.post(`/evaluation-plans/${planId}/duplicate`, { toPeriodId }).then((r) => r.data),
  /** Cambia el formato o las secciones: { format?, sectionIds? } */
  update: (planId, data) => axiosClient.put(`/evaluation-plans/${planId}`, data).then((r) => r.data),

  createProject: (planId, data) => axiosClient.post(`/evaluation-plans/${planId}/project`, data).then((r) => r.data),
  addCompetency: (projectId, data) =>
    axiosClient.post(`/evaluation-plans/projects/${projectId}/competencies`, data).then((r) => r.data),

  createActivity: (planId, data) => axiosClient.post(`/evaluation-plans/${planId}/activities`, data).then((r) => r.data),
  /** Mueve una actividad a otro tema del contenido programático (null la desvincula). */
  setActivityContent: (planId, activityId, programmaticContentId) =>
    axiosClient.patch(`/evaluation-plans/${planId}/activities/${activityId}/content`, { programmaticContentId }).then((r) => r.data),
  /** Plantilla .xlsx de una evaluación detallada. `params`: { sections: 'A,B', topic }. */
  downloadActivityTemplate: async (params) => {
    const res = await axiosClient.get('/evaluation-plans/activity-template', { params, responseType: 'blob' }).catch(unwrapBlobError);
    saveBlob(res.data, fileNameFrom(res.headers, 'plantilla-evaluacion-detallada.xlsx'));
  },
  /** Lee el Excel y devuelve los datos para el formulario: { activity, summary, warnings } (no guarda nada). */
  parseActivityExcel: (file, params) => upload('/evaluation-plans/activity-template/parse', file, params),
  updateActivity: (planId, activityId, data) =>
    axiosClient.put(`/evaluation-plans/${planId}/activities/${activityId}`, data).then((r) => r.data),
  deleteActivity: (planId, activityId) =>
    axiosClient.delete(`/evaluation-plans/${planId}/activities/${activityId}`).then((r) => r.data),

  /** Cierra el plan (exige que las actividades sumen exactamente 100%) / lo reabre. */
  close: (planId) => axiosClient.post(`/evaluation-plans/${planId}/close`).then((r) => r.data),
  reopen: (planId) => axiosClient.post(`/evaluation-plans/${planId}/reopen`).then((r) => r.data),
};

export default evaluationPlansApi;
