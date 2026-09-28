import { axiosClient } from '../axiosClient';

const get = (url, params) => axiosClient.get(url, { params }).then((r) => r.data);
const post = (url, data) => axiosClient.post(url, data).then((r) => r.data);
const put = (url, data) => axiosClient.put(url, data).then((r) => r.data);
const del = (url) => axiosClient.delete(url).then((r) => r.data);

const academicsApi = {
  listLevels: () => get('/academics/levels'),

  listSchoolPeriods: () => get('/academics/school-periods'),
  createSchoolPeriod: (data) => post('/academics/school-periods', data),

  listClassrooms: () => get('/academics/classrooms'),
  createClassroom: (data) => post('/academics/classrooms', data),

  listGrades: (params) => get('/academics/grades', params),
  createGrade: (data) => post('/academics/grades', data),
  updateGrade: (id, data) => put(`/academics/grades/${id}`, data),
  getGradeSubjects: (id) => get(`/academics/grades/${id}/subjects`),
  /** `subjects = [{ subjectId, weeklyHours? }]` en el orden del plan de estudios. */
  setGradeSubjects: (id, subjects) => put(`/academics/grades/${id}/subjects`, { subjects }),

  listSubjects: (params) => get('/academics/subjects', params),
  createSubject: (data) => post('/academics/subjects', data),
  updateSubject: (id, data) => put(`/academics/subjects/${id}`, data),
  deleteSubject: (id) => del(`/academics/subjects/${id}`),

  listSections: (params) => get('/academics/sections', params),
  getSection: (id) => get(`/academics/sections/${id}`),
  createSection: (data) => post('/academics/sections', data),
  updateSection: (id, data) => put(`/academics/sections/${id}`, data),
  getRoster: (id) => get(`/academics/sections/${id}/roster`),

  /**
   * Asignación docente de una sección. La forma depende del nivel:
   *   homeroom → { leadTeacherId, assistantTeacherId }
   *   subjects → { subjects: [{ subjectId, teacherId }] }
   */
  getSectionTeachers: (id) => get(`/academics/sections/${id}/teachers`),
  setSectionTeachers: (id, data) => put(`/academics/sections/${id}/teachers`, data),

  getTeachingLoad: (params) => get('/academics/teaching-load', params),

  enroll: (data) => post('/academics/enrollments', data),
  withdraw: (id) => del(`/academics/enrollments/${id}`),
};

export default academicsApi;
