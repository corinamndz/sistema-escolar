import { axiosClient } from '../axiosClient';

/** Contenido programático por materia, grado y AÑO escolar, con sus actividades de evaluación. */
const programmaticContentApi = {
  /** Materias y grados disponibles (docente: los que dicta) con su cantidad de temas en el año. */
  listOptions: (params) => axiosClient.get('/programmatic-content/options', { params }).then((r) => r.data),
  /**
   * { gradeId, subjectId, schoolPeriodId } → { grade_name, subject_name, school_period,
   *   units: [{ unit, items: [{ id, unit, topic, description, activities: [{ …, plan }] }] }], plans, sections }
   */
  get: (params) => axiosClient.get('/programmatic-content', { params }).then((r) => r.data),
  /** { gradeId, subjectId, schoolPeriodId, unit, topic, description } */
  create: (data) => axiosClient.post('/programmatic-content', data).then((r) => r.data),
  /** { gradeId, subjectId, fromPeriodId, toPeriodId } → { copied, skipped, subject_name, grade_name, from, to } */
  duplicate: (data) => axiosClient.post('/programmatic-content/duplicate', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/programmatic-content/${id}`, data).then((r) => r.data),
  /** → { unlinkedActivities }: sus actividades quedan en su plan, sin contenido. */
  remove: (id) => axiosClient.delete(`/programmatic-content/${id}`).then((r) => r.data),
};

export default programmaticContentApi;
