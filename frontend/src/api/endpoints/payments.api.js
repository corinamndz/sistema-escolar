import { axiosClient } from '../axiosClient';
import { registerCurrencies } from '../../features/payments/currency';

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
  /**
   * `status`: "due" (pendiente + vencido + reportado) o estados separados por coma.
   * `currency`: moneda de referencia en que se estiman los pendientes (columnas conv_*).
   */
  list: (params) => get('/payments', params),
  /** Totales por estado + `total_ref` en `currency` (o la predeterminada). */
  summary: (params) => get('/payments/summary', params),
  listMine: (params) => get('/payments/mine', params),
  /** Cotización exacta de un pago: { currency: 'COP', date: 'YYYY-MM-DD' } → { amount, rate, rate_date, … }. */
  quote: (id, params) => get(`/payments/${id}/quote`, params),
  getOne: (id) => get(`/payments/${id}`),
  register: (data) => post('/payments', data),
  /** Registra el pago (administración). `details` opcional: { method, reference, paidOn, note, currency }. */
  markAsPaid: (id, details, proofFile) => postWithProof(`/payments/${id}/mark-paid`, details, proofFile),
  cancel: (id) => post(`/payments/${id}/cancel`),
  /** Vuelve a generar el PDF del comprobante de un pago confirmado (diseño/logo actuales). */
  regenerateReceipt: (id) => post(`/payments/${id}/receipt`),
  /** Representante: informa que ya pagó ({ method, reference, paidOn, note, currency }). */
  report: (id, data, proofFile) => postWithProof(`/payments/${id}/report`, data, proofFile),
  /** Comprobante adjunto (privado): se descarga con la sesión del usuario como Blob. */
  getProofBlob: (id) => axiosClient.get(`/payments/${id}/proof`, { responseType: 'blob' }).then((r) => r.data),

  listFees: (schoolPeriodId) => get('/payments/tuition/fees', { schoolPeriodId }),
  upsertFee: (data) => axiosClient.put('/payments/tuition/fees', data).then((r) => r.data),
  deleteFee: (id) => axiosClient.delete(`/payments/tuition/fees/${id}`).then((r) => r.data),
  generateTuition: (schoolPeriodId) => post('/payments/tuition/generate', { schoolPeriodId }),

  /** Catálogo de monedas + activas del colegio ({ base, default_currency, catalog: [{ code, name, enabled, … }] }). */
  listCurrencies: () => get('/payments/currencies'),
  /** { currencies: ['VES', 'COP'], defaultCurrency: 'VES' } */
  setCurrencies: (data) => axiosClient.put('/payments/currencies', data).then((r) => r.data),
  /**
   * Tasas vigentes de cada moneda activa (cualquier usuario con sesión):
   * { today, default_currency, currencies: [{ code, name, current, next, stale, … }] }.
   */
  currentRate: () =>
    get('/payments/exchange-rates/current').then((status) => {
      registerCurrencies(status.currencies); // nombres/símbolos del colegio para formatear montos
      return status;
    }),

  // ---- Administración de monedas del colegio ----
  /** { currencies: [configuradas, activas e inactivas, con tasa], available: [catálogo sin configurar], default_currency } */
  currencyAdmin: () =>
    get('/payments/currencies/admin').then((data) => {
      registerCurrencies(data.currencies);
      return data;
    }),
  /** { code, name?, symbol?, decimals?, isActive?, isDefault? } */
  addCurrency: (data) => post('/payments/currencies', data),
  /** Editar / activar / desactivar / marcar predeterminada. */
  updateCurrency: (code, data) => axiosClient.put(`/payments/currencies/${code}`, data).then((r) => r.data),
  /** Solo si nunca se usó (sin tasas ni pagos); si no, hay que desactivarla. */
  removeCurrency: (code) => axiosClient.delete(`/payments/currencies/${code}`).then((r) => r.data),
  listRates: (currency) => get('/payments/exchange-rates', currency ? { currency } : undefined),
  /** { currency, rateDate: 'YYYY-MM-DD' (fecha valor), rate: moneda local por 1 USD } */
  upsertRate: (data) => axiosClient.put('/payments/exchange-rates', data).then((r) => r.data),
  /** Consulta la página del BCV y guarda la tasa del bolívar con su fecha valor. */
  fetchBcvRate: () => post('/payments/exchange-rates/bcv'),
  deleteRate: (id) => axiosClient.delete(`/payments/exchange-rates/${id}`).then((r) => r.data),
};

export default paymentsApi;
