const { ApiError } = require('../../utils/ApiError');

/**
 * Tasa de cambio oficial BCV (Bs por 1 USD).
 *
 * "Fecha valor": el BCV publica hoy la tasa que rige desde el próximo día
 * hábil (p. ej. el viernes publica la del lunes). Por eso la tasa VIGENTE en
 * un día D es la de mayor `rate_date` que no sea posterior a D; una tasa ya
 * publicada con fecha valor futura se muestra como "próxima", no se aplica.
 *
 * Los montos en Bs se calculan en SQL con NUMERIC (round(amount * rate, 2)),
 * nunca con números de punto flotante de JavaScript.
 */

const BASE = 'USD';
const QUOTE = 'VES';
const BCV_URL = process.env.BCV_URL || 'https://www.bcv.org.ve/';
const STALE_AFTER_DAYS = 4; // viernes → lunes son 3 días: más de 4 sin tasa nueva es sospechoso

/**
 * Subconsulta SQL de la tasa vigente para una fila de `payments` (alias p) en
 * la fecha indicada (expresión SQL, por defecto hoy).
 */
const effectiveRateSql = (dateExpr = 'current_date') => `
  SELECT er.rate, er.rate_date
  FROM exchange_rates er
  WHERE er.tenant_id = p.tenant_id AND er.base_currency = '${BASE}' AND er.quote_currency = '${QUOTE}'
    AND er.rate_date <= ${dateExpr}
  ORDER BY er.rate_date DESC
  LIMIT 1`;

/** Tasa vigente en `onDate` ('YYYY-MM-DD'; por defecto hoy según la base de datos) o null. */
async function getEffectiveRate(trx, tenantId, onDate = null) {
  const query = trx('exchange_rates')
    .where({ tenant_id: tenantId, base_currency: BASE, quote_currency: QUOTE })
    .orderBy('rate_date', 'desc')
    .select('id', 'rate', 'rate_date', 'source', 'updated_at')
    .first();
  if (onDate) query.andWhere('rate_date', '<=', onDate);
  else query.andWhereRaw('rate_date <= current_date');
  const row = await query;
  return row ? { ...row, rate: Number(row.rate) } : null;
}

/** Estado para la interfaz: tasa vigente, próxima (fecha valor futura) y si está desactualizada. */
async function getRateStatus(trx, tenantId) {
  const current = await getEffectiveRate(trx, tenantId);
  const next = await trx('exchange_rates')
    .where({ tenant_id: tenantId, base_currency: BASE, quote_currency: QUOTE })
    .andWhereRaw('rate_date > current_date')
    .orderBy('rate_date', 'asc')
    .select('rate', 'rate_date', 'source')
    .first();
  const { rows } = await trx.raw('SELECT current_date::text AS today');
  const today = rows[0].today;
  const ageDays = current ? Math.round((Date.parse(today) - Date.parse(current.rate_date)) / 86400000) : null;
  return {
    base: BASE,
    quote: QUOTE,
    today,
    current,
    next: next ? { ...next, rate: Number(next.rate) } : null,
    stale: current ? ageDays > STALE_AFTER_DAYS : true,
    age_days: ageDays,
  };
}

async function listRates(trx, tenantId, { limit = 30 } = {}) {
  const rows = await trx('exchange_rates as er')
    .leftJoin('users as u', 'u.id', 'er.created_by')
    .where({ 'er.tenant_id': tenantId, 'er.base_currency': BASE, 'er.quote_currency': QUOTE })
    .select('er.id', 'er.rate', 'er.rate_date', 'er.source', 'er.updated_at', 'u.full_name as created_by_name')
    .orderBy('er.rate_date', 'desc')
    .limit(limit);
  return rows.map((r) => ({ ...r, rate: Number(r.rate) }));
}

/** Registra (o corrige) la tasa de una fecha valor. */
async function upsertRate(trx, tenantId, { rateDate, rate, source = 'manual' }, userId = null) {
  const { rows } = await trx.raw("SELECT (?::date > current_date + 7) AS too_far", [rateDate]);
  if (rows[0].too_far) {
    throw ApiError.badRequest('La fecha valor no puede ser más de 7 días posterior a hoy.', [
      { path: 'rateDate', message: 'Fecha demasiado lejana.' },
    ]);
  }
  await trx('exchange_rates')
    .insert({ tenant_id: tenantId, base_currency: BASE, quote_currency: QUOTE, rate_date: rateDate, rate, source, created_by: userId })
    .onConflict(['tenant_id', 'base_currency', 'quote_currency', 'rate_date'])
    .merge({ rate, source, created_by: userId, updated_at: trx.fn.now() });
  return getRateStatus(trx, tenantId);
}

/** Borra una tasa cargada por error, salvo que ya se haya usado en un pago confirmado. */
async function deleteRate(trx, tenantId, id) {
  const rate = await trx('exchange_rates').where({ id, tenant_id: tenantId }).first();
  if (!rate) throw ApiError.notFound('Tasa no encontrada.');
  const used = await trx('payments').where({ tenant_id: tenantId, exchange_rate_date: rate.rate_date }).first();
  if (used) {
    throw ApiError.conflict('No se puede eliminar: ya se usó para confirmar pagos. Corrige el valor registrándola de nuevo.');
  }
  await trx('exchange_rates').where({ id }).delete();
}

// ---------------------------------------------------------------------------
// Consulta a la página del BCV
// ---------------------------------------------------------------------------

/**
 * Extrae la tasa del USD y su fecha valor del HTML de https://www.bcv.org.ve/.
 * Estructura actual: <div id="dolar"> … <strong>857,00580000</strong> y
 * "Fecha Valor: <span … content="2026-09-28T00:00:00-04:00">".
 * Lanza un error si no reconoce el formato (nunca guarda un valor dudoso).
 */
function parseBcvHtml(html) {
  const block = /id="dolar"[\s\S]{0,1500}?<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/i.exec(html);
  const date = /Fecha\s+Valor:[\s\S]{0,300}?content="(\d{4}-\d{2}-\d{2})/i.exec(html);
  if (!block || !date) {
    throw new Error('No se reconoció el formato de la página del BCV (tasa del USD o fecha valor).');
  }
  // Formato venezolano: "1.234,56780000" → 1234.5678
  const rate = Number(block[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Tasa del BCV inválida: "${block[1]}".`);
  return { rate, rateDate: date[1] };
}

async function fetchBcvRate({ timeoutMs = 15000 } = {}) {
  let html;
  try {
    const res = await fetch(BCV_URL, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'SistemaEscolar/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    throw ApiError.unprocessable(`No se pudo consultar la página del BCV (${err.message}). Registra la tasa manualmente.`);
  }
  try {
    return parseBcvHtml(html);
  } catch (err) {
    throw ApiError.unprocessable(`${err.message} Registra la tasa manualmente.`);
  }
}

/** Consulta el BCV y guarda la tasa publicada (con su fecha valor) para el colegio. */
async function updateFromBcv(trx, tenantId, userId = null) {
  const { rate, rateDate } = await fetchBcvRate();
  const status = await upsertRate(trx, tenantId, { rateDate, rate, source: 'bcv' }, userId);
  return { fetched: { rate, rate_date: rateDate }, ...status };
}

module.exports = {
  BASE,
  QUOTE,
  effectiveRateSql,
  getEffectiveRate,
  getRateStatus,
  listRates,
  upsertRate,
  deleteRate,
  parseBcvHtml,
  fetchBcvRate,
  updateFromBcv,
};
