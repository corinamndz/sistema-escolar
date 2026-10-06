import { axiosClient } from '../axiosClient';

const get = (url, params) => axiosClient.get(url, { params }).then((r) => r.data);

const schedulesApi = {
  /** Secciones para elegir (administración). */
  listSections: (params) => get('/schedules/sections', params),
  /** Bloques horarios del año escolar. */
  getSlots: (periodId) => get(`/schedules/periods/${periodId}/slots`),
  /** Reemplaza los bloques del año: [{ id?, name, startTime, endTime, isBreak }]. */
  saveSlots: (periodId, slots) => axiosClient.put(`/schedules/periods/${periodId}/slots`, { slots }).then((r) => r.data),
  /** { section, days, slots, entries, read_only, bank?, teacher_busy? } */
  getSection: (sectionId) => get(`/schedules/sections/${sectionId}`),
  /** Coloca una materia: { subjectId, dayOfWeek, timeSlotId }. 409 si hay cruce del docente o la celda está ocupada. */
  place: (sectionId, data) => axiosClient.post(`/schedules/sections/${sectionId}/entries`, data).then((r) => r.data),
  /** Mueve una clase: { dayOfWeek, timeSlotId }. */
  move: (entryId, data) => axiosClient.put(`/schedules/entries/${entryId}`, data).then((r) => r.data),
  remove: (entryId) => axiosClient.delete(`/schedules/entries/${entryId}`).then((r) => r.data),
  /**
   * Horario filtrado (solo lectura): { school_period_id | section_id, grade_id?, teacher_id? }.
   * → { school_period, grade, section, teacher, days, slots, entries, summary }
   */
  query: (filters) => get('/schedules', filters),
  /** Docentes A-Z con sus horas en el año: [{ id, name, active, classes, sections }]. */
  listTeachers: (schoolPeriodId) => get('/schedules/teachers', { school_period_id: schoolPeriodId }),
  /** Horario semanal del docente autenticado. */
  mine: () => get('/schedules/mine'),
};

export default schedulesApi;
