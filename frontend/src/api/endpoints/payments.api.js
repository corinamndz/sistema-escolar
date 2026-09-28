import { axiosClient } from '../axiosClient';

const get = (url, params) => axiosClient.get(url, { params }).then((r) => r.data);
const post = (url, data) => axiosClient.post(url, data).then((r) => r.data);

/**
 * Con archivo adjunto: multipart/form-data (campos + `proof`); sin archivo: JSON.
 * Hay que pisar el Content-Type JSON por defecto del cliente: si no, axios
 * serializa el FormData a JSON y el archivo se pierde.
 */
function postWithProof(url, data, file) {
  if (!file) return post(url, data || {});
  const form = new FormData();
  Object.entries(data || {}).forEach(([k, v]) => v !== undefined && v !== null && form.append(k, v));
  form.append('proof', file);
  return axiosClient.post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
}

const paymentsApi = {
  /** `status`: "due" (pendiente + vencido + reportado) o estados separados por coma. */
  list: (params) => get('/payments', params),
  summary: (params) => get('/payments/summary', params),
  listMine: () => get('/payments/mine'),
  getOne: (id) => get(`/payments/${id}`),
  register: (data) => post('/payments', data),
  /** Registra el pago (administración). `details` opcional: { method, reference, paidOn, note }. */
  markAsPaid: (id, details, proofFile) => postWithProof(`/payments/${id}/mark-paid`, details, proofFile),
  cancel: (id) => post(`/payments/${id}/cancel`),
  /** Vuelve a generar el PDF del comprobante de un pago confirmado (diseño/logo actuales). */
  regenerateReceipt: (id) => post(`/payments/${id}/receipt`),
  /** Representante: informa que ya pagó ({ method, reference, paidOn, note }). */
  report: (id, data, proofFile) => postWithProof(`/payments/${id}/report`, data, proofFile),
  /** Comprobante adjunto (privado): se descarga con la sesión del usuario como Blob. */
  getProofBlob: (id) => axiosClient.get(`/payments/${id}/proof`, { responseType: 'blob' }).then((r) => r.data),

  listFees: (schoolPeriodId) => get('/payments/tuition/fees', { schoolPeriodId }),
  upsertFee: (data) => axiosClient.put('/payments/tuition/fees', data).then((r) => r.data),
  deleteFee: (id) => axiosClient.delete(`/payments/tuition/fees/${id}`).then((r) => r.data),
  generateTuition: (schoolPeriodId) => post('/payments/tuition/generate', { schoolPeriodId }),

  /** Tasa BCV: { today, current: { rate, rate_date, source }, next, stale } (cualquier usuario con sesión). */
  currentRate: () => get('/payments/exchange-rates/current'),
  listRates: () => get('/payments/exchange-rates'),
  /** { rateDate: 'YYYY-MM-DD' (fecha valor), rate: Bs por USD } */
  upsertRate: (data) => axiosClient.put('/payments/exchange-rates', data).then((r) => r.data),
  /** Consulta la página del BCV y guarda la tasa publicada con su fecha valor. */
  fetchBcvRate: () => post('/payments/exchange-rates/bcv'),
  deleteRate: (id) => axiosClient.delete(`/payments/exchange-rates/${id}`).then((r) => r.data),
};

export default paymentsApi;
