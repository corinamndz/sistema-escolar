import { axiosClient } from '../axiosClient';

/** Ruta base del objeto revisado: un plan ({ planId }) o el programa de una materia en un grado ({ gradeId, subjectId }). */
const base = (t) => (t.planId ? `/reviews/plans/${t.planId}` : `/reviews/contents/${t.gradeId}/${t.subjectId}`);

/** Revisión y aprobación de planes de evaluación y contenido programático. */
const reviewsApi = {
  /** { status, status_label, my_role, can: { submit, review, comment }, comments, … } */
  get: (target) => axiosClient.get(base(target)).then((r) => r.data),
  /** Docente: enviar o reenviar a revisión (comentario opcional). */
  submit: (target, comment) => axiosClient.post(`${base(target)}/submit`, { comment: comment || undefined }).then((r) => r.data),
  /** Revisor: decision 'approve' | 'observe' (observe exige comentario). */
  review: (target, decision, comment) => axiosClient.post(`${base(target)}/review`, { decision, comment: comment || undefined }).then((r) => r.data),
  comment: (target, body) => axiosClient.post(`${base(target)}/comments`, { body }).then((r) => r.data),
  /** Pendientes de revisión del coordinador (su nivel) o del Director: { reviewer, level, items }. */
  inbox: () => axiosClient.get('/reviews/inbox').then((r) => r.data),
};

export default reviewsApi;
