import { axiosClient } from '../axiosClient';

const eventsApi = {
  /** Eventos (también borradores): [{ id, title, category, audience_label, dates: [{ date, start_time, end_time }], next_date, is_past, … }]. */
  list: (params = {}) => axiosClient.get('/events', { params }).then((r) => r.data),
  /** Destinos para el formulario: { grades: [{ id, name }], sections: [{ id, name, grade_name, school_period_name }] }. */
  audiences: () => axiosClient.get('/events/audiences').then((r) => r.data),
  get: (id) => axiosClient.get(`/events/${id}`).then((r) => r.data),
  /** { title, category, description, location, audience, gradeId, sectionId, isPublished, dates: [{ date, startTime, endTime }] } */
  create: (data) => axiosClient.post('/events', data).then((r) => r.data),
  update: (id, data) => axiosClient.put(`/events/${id}`, data).then((r) => r.data),
  remove: (id) => axiosClient.delete(`/events/${id}`).then((r) => r.data),
};

export default eventsApi;
