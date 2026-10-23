import { axiosClient } from '../axiosClient';

const get = (url, params) => axiosClient.get(url, { params }).then((r) => r.data);
const post = (url, data) => axiosClient.post(url, data).then((r) => r.data);
const put = (url, data) => axiosClient.put(url, data).then((r) => r.data);
const del = (url) => axiosClient.delete(url).then((r) => r.data);

const academicsApi = {
  listLevels: () => get('/academics/levels'),

  listSchoolPeriods: () => get('/academics/school-periods'),
  createSchoolPeriod: (data) => post('/academics/school-periods', data),
  /** Qué se eliminaría al borrar el año: { school_period, impact: { sections, enrollments, evaluation_plans, … }, is_last }. */
  getPeriodDeletionImpact: (id) => get(`/academics/school-periods/${id}/deletion-impact`),
  /** Borra el año y todo lo asociado. `confirmName`: el nombre exacto del año. */
  deleteSchoolPeriod: (id, confirmName) => axiosClient.delete(`/academics/school-periods/${id}`, { data: { confirmName } }).then((r) => r.data),
  /** Finaliza el año (exige que no queden alumnos cursando) / lo reabre para corregir. */
  /** Transición de año: qué tiene el año de origen, qué se comparte, avisos y nombre/fechas sugeridos. */
  getRolloverPreview: (id) => get(`/academics/school-periods/${id}/rollover-preview`),
  /** `{ target: { name, startDate?, endDate? } | { periodId }, options: { sections, teachers, terms, evaluationRules, timeSlots, schedule, tuition } }` */
  executeRollover: (id, data) => post(`/academics/school-periods/${id}/rollover`, data),
  closeSchoolPeriod: (id) => post(`/academics/school-periods/${id}/close`),
  reopenSchoolPeriod: (id) => post(`/academics/school-periods/${id}/reopen`),
  /** Normativa del año: nota mínima, reprobadas permitidas, promedio de lapsos (aritmético/ponderado), redondeo. */
  getEvaluationRules: (id) => get(`/academics/school-periods/${id}/evaluation-rules`),
  updateEvaluationRules: (id, data) => put(`/academics/school-periods/${id}/evaluation-rules`, data),

  // ---- Promoción de alumnos ----
  /** { fromPeriodId, toPeriodId, gradeId?, maxFailed? } → alumnos con notas, promedio y sugerencia. */
  promotionPreview: (params) => get('/academics/promotion/preview', params),
  /** { fromPeriodId, toPeriodId, decisions: [{ enrollmentId, action, targetSectionId?, createSectionName?, notes? }] } */
  executePromotion: (data) => post('/academics/promotion', data),
  undoPromotion: (enrollmentId) => post(`/academics/promotion/${enrollmentId}/undo`),

  listClassrooms: () => get('/academics/classrooms'),
  createClassroom: (data) => post('/academics/classrooms', data),

  listGrades: (params) => get('/academics/grades', params),
  createGrade: (data) => post('/academics/grades', data),
  updateGrade: (id, data) => put(`/academics/grades/${id}`, data),
  /** Panel del grado en Grados y secciones: { grade (con subject_count), teachers, sections (con su personal docente) }. */
  getGradePanel: (id, schoolPeriodId) => get(`/academics/grades/${id}/panel`, { schoolPeriodId }),

  // ---- Materias ----
  /** Con `{ schoolPeriodId }` cada materia trae `offering` (grados, secciones disponibles y cobertura docente). */
  listSubjects: (params) => get('/academics/subjects', params),
  /** `{ name, assignments?: { grades: [...] } }` (ver setSubjectAssignments). */
  createSubject: (data) => post('/academics/subjects', data),
  updateSubject: (id, data) => put(`/academics/subjects/${id}`, data),
  deleteSubject: (id) => del(`/academics/subjects/${id}`),
  /** { subject, school_period, grades: [{ …, offered, weekly_hours, sections: [{ id, name, available, teacher, homeroom_teacher, has_plans }] }], teachers } */
  getSubjectAssignments: (id, schoolPeriodId) => get(`/academics/subjects/${id}/assignments`, { schoolPeriodId }),
  /** `{ schoolPeriodId?, grades: [{ gradeId, weeklyHours?, sections?: [{ sectionId, available, teacherId? }] }] }` */
  setSubjectAssignments: (id, data) => put(`/academics/subjects/${id}/assignments`, data),
  /** Misma forma que getSubjectAssignments, vacía: para el formulario de una materia nueva. */
  getSubjectAssignmentOptions: (schoolPeriodId) => get('/academics/subjects/assignment-options', { schoolPeriodId }),

  listSections: (params) => get('/academics/sections', params),
  getSection: (id) => get(`/academics/sections/${id}`),
  createSection: (data) => post('/academics/sections', data),
  updateSection: (id, data) => put(`/academics/sections/${id}`, data),
  /** Solo si no tiene alumnos ni planes de evaluación → { removedAssignments, removedScheduleClasses }. */
  deleteSection: (id) => del(`/academics/sections/${id}`),
  getRoster: (id) => get(`/academics/sections/${id}/roster`),

  /**
   * Personal docente de la sección según su nivel:
   *   Inicial    → { leadTeacherId, assistantTeacherId }  (docente y docente auxiliar)
   *   Primaria   → { leadTeacherId }                      (docente)
   *   Secundaria → { guideTeacherId }                     (docente guía)
   * El docente de cada materia se asigna en Materias (setSubjectAssignments).
   */
  getSectionTeachers: (id) => get(`/academics/sections/${id}/teachers`),
  setSectionTeachers: (id, data) => put(`/academics/sections/${id}/teachers`, data),

  getTeachingLoad: (params) => get('/academics/teaching-load', params),

  enroll: (data) => post('/academics/enrollments', data),
  enrollBulk: (data) => post('/academics/enrollments/bulk', data),
  withdraw: (id) => del(`/academics/enrollments/${id}`),
};

export default academicsApi;
