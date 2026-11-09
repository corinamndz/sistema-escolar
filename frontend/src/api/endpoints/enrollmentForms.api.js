import { axiosClient } from '../axiosClient';

const data = (r) => r.data;

/** Planillas de inscripción personalizables (backend: modules/enrollment-forms). */
const enrollmentFormsApi = {
  // ---- Administración ----
  /** [{ id, title, status, school_period_name, question_count, submissions, pending }] */
  list: () => axiosClient.get('/enrollment-forms').then(data),
  /** Años escolares abiertos. */
  periods: () => axiosClient.get('/enrollment-forms/periods').then(data),
  /** { schoolPeriodId, title, description?, copyFromId? } → planilla (con la plantilla base o copiada) */
  create: (body) => axiosClient.post('/enrollment-forms', body).then(data),
  get: (id) => axiosClient.get(`/enrollment-forms/${id}`).then(data),
  /** { title?, description?, fields? } */
  update: (id, body) => axiosClient.put(`/enrollment-forms/${id}`, body).then(data),
  /** PDF de ejemplo (datos ficticios) con esa plantilla, sin guardar nada. */
  formPdfPreview: (id, template) => axiosClient.get(`/enrollment-forms/${id}/pdf-preview`, { params: { template }, responseType: 'blob' }).then(data),
  /** status: draft | published | closed */
  setStatus: (id, status) => axiosClient.post(`/enrollment-forms/${id}/status`, { status }).then(data),
  remove: (id) => axiosClient.delete(`/enrollment-forms/${id}`).then(data),
  submissions: (id, status) => axiosClient.get(`/enrollment-forms/${id}/submissions`, { params: status ? { status } : {} }).then(data),
  submission: (id) => axiosClient.get(`/enrollment-forms/submissions/${id}`).then(data),
  /** { status: rejected | changes_requested, note } — aprobar va por `approve`. */
  review: (id, body) => axiosClient.post(`/enrollment-forms/submissions/${id}/review`, body).then(data),
  /** Historial de planillas de un alumno → { student, submissions: [{ school_period_name, grade_name, section_name, status, … }] } */
  studentHistory: (studentId) => axiosClient.get(`/enrollment-forms/students/${studentId}/history`).then(data),
  /** Bandeja de todas las planillas recibidas → { rows, counts, forms }. Filtros: status, formId, kind (new|renewal), q. */
  inbox: (params = {}) => axiosClient.get('/enrollment-forms/submissions', { params }).then(data),
  /** Propuesta de alta: { student, placement, legal, submitter, relationships, form } */
  approvalDraft: (id) => axiosClient.get(`/enrollment-forms/submissions/${id}/approval`).then(data),
  /** Aprueba e inscribe (una transacción): { student, sectionId, legal, submitterRelationship?, note? } → { submission, result } */
  approve: (id, body) => axiosClient.post(`/enrollment-forms/submissions/${id}/approve`, body).then(data),

  /** PDF de una planilla recibida (membrete del colegio y firmas) como Blob. */
  submissionPdf: (id) => axiosClient.get(`/enrollment-forms/submissions/${id}/pdf`, { responseType: 'blob' }).then(data),

  // ---- «Ver como representante» (Administrador, solo lectura) ----
  /** El portal de Inscripción de ese representante → { guardian, forms, students, submissions, reminders } */
  preview: (guardianId) => axiosClient.get(`/enrollment-forms/preview/guardians/${guardianId}`).then(data),
  previewPrefill: (guardianId, formId, studentId) => axiosClient.get(`/enrollment-forms/preview/guardians/${guardianId}/forms/${formId}/prefill`, { params: { studentId } }).then(data),
  /** «Probar envío»: las validaciones del envío real, sin guardar → { dryRun, ok, wouldUpdate } */
  previewCheck: (guardianId, formId, body) => axiosClient.post(`/enrollment-forms/preview/guardians/${guardianId}/forms/${formId}/check`, body).then(data),

  // ---- Portal del representante ----
  /** Sube la foto del alumno (JPG o PNG, hasta 4 MB) → { file } (valor del campo foto). */
  uploadPhoto: (file) => {
    const form = new FormData();
    form.append('photo', file);
    return axiosClient.post('/enrollment-forms/portal/photos', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(data);
  },
  /** Foto privada como Blob: la del representante (portal) o cualquiera (administración). */
  portalPhoto: (file) => axiosClient.get(`/enrollment-forms/portal/photos/${file}`, { responseType: 'blob' }).then(data),
  adminPhoto: (file) => axiosClient.get(`/enrollment-forms/photos/${file}`, { responseType: 'blob' }).then(data),
  /** PDF de una planilla propia. */
  portalSubmissionPdf: (id) => axiosClient.get(`/enrollment-forms/portal/submissions/${id}/pdf`, { responseType: 'blob' }).then(data),
  /** Inscripciones pendientes de la familia (aviso del inicio): [{ student_name, school_period_name, grade_name, state }] */
  portalReminders: () => axiosClient.get('/enrollment-forms/portal/reminders').then(data),
  /** { forms, students, submissions, reminders } */
  portal: () => axiosClient.get('/enrollment-forms/portal').then(data),
  /** Respuestas precargadas para re-inscribir a un alumno registrado → { answers, sources, previous } */
  prefill: (formId, studentId) => axiosClient.get(`/enrollment-forms/portal/${formId}/prefill`, { params: { studentId } }).then(data),
  /** Elimina una planilla propia en revisión o por corregir. */
  removeSubmission: (id) => axiosClient.delete(`/enrollment-forms/portal/submissions/${id}`).then(data),
  /** { studentId? | applicantName?, submissionId?, answers } */
  submit: (formId, body) => axiosClient.post(`/enrollment-forms/portal/${formId}/submit`, body).then(data),
};

export default enrollmentFormsApi;
