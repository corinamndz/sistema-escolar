import { axiosClient } from '../axiosClient';

const data = (r) => r.data;
/** Alcance del diseño: { schoolPeriodId, levelCode }; vacío = todos los años / niveles. */
const params = (scope = {}) => ({ schoolPeriodId: scope.schoolPeriodId || '', levelCode: scope.levelCode || '' });

/** Certificados de promoción del colegio, con un diseño por año y nivel si se quiere. */
const certificatesApi = {
  /** → { template | null, effective | null, effective_label, designs, periods, levels, variables } */
  get: (scope) => axiosClient.get('/certificate-template', { params: params(scope) }).then(data),
  /** Sube o reemplaza el fondo (PNG, JPG o PDF) → { template, pages } */
  uploadBackground: (scope, file) => {
    const form = new FormData();
    form.append('background', file);
    return axiosClient.post('/certificate-template/background', form, { params: params(scope), headers: { 'Content-Type': 'multipart/form-data' } }).then(data);
  },
  background: (scope) => axiosClient.get('/certificate-template/background', { params: params(scope), responseType: 'blob' }).then(data),
  /** Fondo de una plantilla estándar con el color del colegio (PDF). */
  standardPreview: (key) => axiosClient.get(`/certificate-template/standard/${key}/pdf`, { responseType: 'blob' }).then(data),
  /** Usa una plantilla estándar como fondo de ese alcance → { template, suggested } */
  applyStandard: (scope, key) => axiosClient.post(`/certificate-template/standard/${key}`, {}, { params: params(scope) }).then(data),
  /** Crea el diseño propio de ese alcance copiando el que hereda. */
  customize: (scope) => axiosClient.post('/certificate-template/customize', {}, { params: params(scope) }).then(data),
  /** Elimina el diseño propio de ese alcance: vuelve a usar el que hereda. */
  remove: (scope) => axiosClient.delete('/certificate-template', { params: params(scope) }).then(data),
  /** Lo que pueden descargar las familias en el portal. */
  setPublished: (scope, published) => axiosClient.put('/certificate-template/publish', { published }, { params: params(scope) }).then(data),
  saveFields: (scope, fields) => axiosClient.put('/certificate-template', { fields }, { params: params(scope) }).then(data),
  /** PDF con datos de ejemplo y las posiciones aún sin guardar. */
  preview: (scope, fields) => axiosClient.post('/certificate-template/preview', { fields }, { params: params(scope), responseType: 'blob' }).then(data),
  /** Varios certificados en un solo PDF, una página por alumno (cada uno con el diseño de su año y nivel). */
  batch: (enrollmentIds) => axiosClient.post('/certificate-template/batch', { enrollmentIds }, { responseType: 'blob' }).then(data),
  /** Certificado real de un alumno (su última promoción, o esa matrícula). */
  studentPdf: (studentId, enrollmentId) => axiosClient.get(`/certificate-template/students/${studentId}/pdf`, { params: enrollmentId ? { enrollmentId } : undefined, responseType: 'blob' }).then(data),
};

export default certificatesApi;
