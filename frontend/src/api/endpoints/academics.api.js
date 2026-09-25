import { axiosClient } from '../axiosClient';

const academicsApi = {
  listSchoolPeriods: () => axiosClient.get('/academics/school-periods').then((r) => r.data),
  createSchoolPeriod: (data) => axiosClient.post('/academics/school-periods', data).then((r) => r.data),

  listClassrooms: () => axiosClient.get('/academics/classrooms').then((r) => r.data),
  createClassroom: (data) => axiosClient.post('/academics/classrooms', data).then((r) => r.data),

  listGrades: () => axiosClient.get('/academics/grades').then((r) => r.data),
  createGrade: (data) => axiosClient.post('/academics/grades', data).then((r) => r.data),

  listSections: (params) => axiosClient.get('/academics/sections', { params }).then((r) => r.data),
  getSection: (id) => axiosClient.get(`/academics/sections/${id}`).then((r) => r.data),
  createSection: (data) => axiosClient.post('/academics/sections', data).then((r) => r.data),
  updateSection: (id, data) => axiosClient.put(`/academics/sections/${id}`, data).then((r) => r.data),
  getRoster: (id) => axiosClient.get(`/academics/sections/${id}/roster`).then((r) => r.data),

  enroll: (data) => axiosClient.post('/academics/enrollments', data).then((r) => r.data),
  withdraw: (id) => axiosClient.delete(`/academics/enrollments/${id}`).then((r) => r.data),
};

export default academicsApi;
