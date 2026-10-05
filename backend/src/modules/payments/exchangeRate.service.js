const { ApiError } = require('../../utils/ApiError');

/**
 * Monedas y tasas de cambio (moneda local por 1 USD) — migrations/007 y 010.
 *
 * - El USD es la moneda base: las tarifas se fijan en USD y se cobran en la
 *   moneda de referencia que elija quien paga (VES, COP, PEN, ARS…).
 * - Cada colegio activa sus monedas de referencia (`tenant_currencies`) y
 *   marca una como predeterminada. El USD siempre está disponible y no
 *   necesita tasa.
 * - "Fecha valor": la tasa VIGENTE en un día D es la de mayor `rate_date` que
 *   no sea posterior a D (el BCV publica hoy la que rige desde el próximo día
 *   hábil; un fin de semana sigue rigiendo la del viernes). El mismo criterio
 *   vale para cualquier moneda.
 * - Los montos convertidos se calculan en SQL con NUMERIC
 *   (round(monto × tasa, decimales de la moneda)), nunca con floats de JS.
 */

const BASE = 'USD';
const LEGACY_DEFAULT = 'VES'; // colegios sin configuración: comportamiento anterior a 010
const BCV_URL = process.env.BCV_URL || 'https://www.bcv.org.ve/';
const STALE_AFTER_DAYS = 4; // viernes → lunes son 3 días: más de 4 sin tasa nueva es sospechoso

// ---------------------------------------------------------------------------
// Catálogo y monedas del colegio
// ---------------------------------------------------------------------------

/** Catálogo global (referencia ISO 4217, compartido por todos los colegios). */
async function listCurrencies(trx) {
  return trx('currencies').orderBy('sort_order');
}

/**
 * Datos EFECTIVOS de las monedas del colegio: la personalización del colegio
 * (nombre, símbolo, decimales) o, si no la tiene, la del catálogo.
 */
function tenantCurrencyQuery(trx, tenantId) {
  return trx('tenant_currencies as tc')
    .join('currencies as c', 'c.code', 'tc.currency_code')
    .where('tc.tenant_id', tenantId)
    .select(
      'c.code',
      trx.raw('COALESCE(tc.name, c.name) AS name'),
      trx.raw('COALESCE(tc.symbol, c.symbol) AS symbol'),
      trx.raw('COALESCE(tc.decimals, c.decimals) AS decimals'),
      'c.country',
      'c.locale',
      'c.official_source',
      'c.sort_order',
      'tc.is_active',
      'tc.is_default',
      'tc.updated_at',
      // Valores del catálogo, para mostrar si el colegio los personalizó.
      'c.name as catalog_name',
      'c.symbol as catalog_symbol',
      'c.decimals as catalog_decimals'
    )
    .orderBy('c.sort_order');
}

/**
 * Datos de una moneda para ESTE colegio (personalizados si los tiene; si no
 * está configurada, los del catálogo). Error si el código no existe.
 */
async function getCurrency(trx, code, tenantId = null) {
  if (tenantId) {
    const own = await tenantCurrencyQuery(trx, tenantId).andWhere('c.code', code).first();
    if (own) return own;
  }
  const currency = await trx('currencies').where({ code }).first();
  if (!currency) throw ApiError.badRequest(`Moneda desconocida: ${code}.`, [{ path: 'currency', message: 'Moneda desconocida.' }]);
  return currency;
}

/**
 * Monedas del colegio (sin USD). Por defecto solo las ACTIVAS: son las que se
 * ofrecen en los selectores. Si el colegio aún no configuró ninguna (colegio
 * nuevo), se activa el bolívar como predeterminada, como antes de 010.
 */
async function getTenantCurrencies(trx, tenantId, { includeInactive = false } = {}) {
  let rows = await tenantCurrencyQuery(trx, tenantId);
  if (rows.length === 0) {
    await trx('tenant_currencies').insert({ tenant_id: tenantId, currency_code: LEGACY_DEFAULT, is_default: true }).onConflict().ignore();
    rows = await tenantCurrencyQuery(trx, tenantId);
  }
  return includeInactive ? rows : rows.filter((r) => r.is_active);
}

async function getDefaultCurrency(trx, tenantId) {
  const rows = await getTenantCurrencies(trx, tenantId);
  return (rows.find((r) => r.is_default) || rows[0] || { code: LEGACY_DEFAULT }).code;
}

/**
 * Valida una moneda de referencia elegida para un pago o una vista: USD o
 * una moneda ACTIVA del colegio. Devuelve el código normalizado.
 */
async function assertRefCurrency(trx, tenantId, code) {
  const normalized = String(code).trim().toUpperCase();
  if (normalized === BASE) return BASE;
  const enabled = await getTenantCurrencies(trx, tenantId);
  if (!enabled.some((c) => c.code === normalized)) {
    throw ApiError.badRequest(`El colegio no tiene activada la moneda ${normalized}.`, [
      { path: 'currency', message: 'Moneda no activada.' },
    ]);
  }
  return normalized;
}

/** Deja `code` como única predeterminada del colegio (índice único parcial: primero se desmarcan las demás). */
async function markDefault(trx, tenantId, code) {
  await trx('tenant_currencies').where({ tenant_id: tenantId }).whereNot('currency_code', code).update({ is_default: false });
  await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: code }).update({ is_default: true, updated_at: trx.fn.now() });
}

/**
 * Configuración masiva (compatibilidad): activa las monedas de la lista y
 * DESACTIVA el resto (no se borran: conservan su personalización y sus tasas).
 * `{ currencies: ['VES', 'COP'], defaultCurrency: 'VES' }`
 */
async function setTenantCurrencies(trx, tenantId, { currencies, defaultCurrency }) {
  const codes = [...new Set(currencies.map((c) => c.toUpperCase()))].filter((c) => c !== BASE);
  if (codes.length === 0) {
    throw ApiError.badRequest('Activa al menos una moneda de referencia.', [{ path: 'currencies', message: 'Elige al menos una.' }]);
  }
  const known = await trx('currencies').whereIn('code', codes).pluck('code');
  const unknown = codes.filter((c) => !known.includes(c));
  if (unknown.length) throw ApiError.badRequest(`Monedas desconocidas: ${unknown.join(', ')}.`);
  const def = (defaultCurrency || codes[0]).toUpperCase();
  if (!codes.includes(def)) {
    throw ApiError.badRequest('La moneda predeterminada debe estar entre las activas.', [{ path: 'defaultCurrency', message: 'No está activa.' }]);
  }

  await trx('tenant_currencies')
    .where({ tenant_id: tenantId })
    .whereNotIn('currency_code', codes)
    .update({ is_active: false, is_default: false, updated_at: trx.fn.now() });
  for (const code of codes) {
    await trx('tenant_currencies')
      .insert({ tenant_id: tenantId, currency_code: code, is_active: true })
      .onConflict(['tenant_id', 'currency_code'])
      .merge({ is_active: true, updated_at: trx.fn.now() });
  }
  await markDefault(trx, tenantId, def);
  return getRateStatus(trx, tenantId);
}

// ---------------------------------------------------------------------------
// Administración de monedas del colegio (CRUD)
// ---------------------------------------------------------------------------

/**
 * Para la pantalla de administración: monedas configuradas del colegio
 * (activas e inactivas, con su tasa vigente) y las del catálogo que aún se
 * pueden agregar.
 */
async function listCurrencyAdmin(trx, tenantId) {
  const configured = await getTenantCurrencies(trx, tenantId, { includeInactive: true });
  const status = await getRateStatus(trx, tenantId, { includeInactive: true });
  const byCode = new Map(status.currencies.map((c) => [c.code, c]));
  const catalog = await listCurrencies(trx);
  const used = new Set(configured.map((c) => c.code));
  return {
    base: BASE,
    today: status.today,
    default_currency: status.default_currency,
    currencies: configured.map((c) => ({ ...c, ...byCode.get(c.code) })),
    available: catalog.filter((c) => c.code !== BASE && !used.has(c.code)),
  };
}

/** Normaliza la personalización: texto vacío o igual al catálogo → NULL (usar el catálogo). */
function overrides(catalog, { name, symbol, decimals }) {
  const out = {};
  if (name !== undefined) out.name = name && name.trim() && name.trim() !== catalog.name ? name.trim() : null;
  if (symbol !== undefined) out.symbol = symbol && symbol.trim() && symbol.trim() !== catalog.symbol ? symbol.trim() : null;
  if (decimals !== undefined) out.decimals = decimals === null || decimals === catalog.decimals ? null : decimals;
  return out;
}

/** Agrega una moneda del catálogo al colegio (con personalización opcional). */
async function addTenantCurrency(trx, tenantId, { code, name, symbol, decimals, isActive = true, isDefault = false }) {
  const normalized = code.toUpperCase();
  if (normalized === BASE) throw ApiError.badRequest('El dólar es la moneda base: siempre está disponible.', [{ path: 'code', message: 'No aplica.' }]);
  const catalog = await trx('currencies').where({ code: normalized }).first();
  if (!catalog) {
    throw ApiError.badRequest(`La moneda ${normalized} no está en el catálogo del sistema.`, [{ path: 'code', message: 'Código no disponible.' }]);
  }
  const existing = await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: normalized }).first();
  if (existing) {
    throw ApiError.conflict(
      existing.is_active ? `${catalog.name} (${normalized}) ya está configurada.` : `${catalog.name} (${normalized}) ya está configurada pero inactiva: actívala.`,
      [{ path: 'code', message: 'Ya configurada.' }]
    );
  }
  if (isDefault && !isActive) throw ApiError.badRequest('La moneda predeterminada debe estar activa.', [{ path: 'isDefault', message: 'Actívala.' }]);

  await trx('tenant_currencies').insert({
    tenant_id: tenantId,
    currency_code: normalized,
    is_active: isActive,
    is_default: false,
    ...overrides(catalog, { name, symbol, decimals }),
  });
  if (isDefault) await markDefault(trx, tenantId, normalized);
  return getCurrencyAdminItem(trx, tenantId, normalized);
}

/**
 * Edita una moneda del colegio: nombre, símbolo, decimales, activa, predeterminada.
 * - No se puede desactivar ni "des-predeterminar" la predeterminada: primero
 *   se marca otra (siempre tiene que haber una).
 * - Los decimales solo afectan conversiones FUTURAS: los pagos confirmados
 *   guardan su monto ya redondeado.
 */
async function updateTenantCurrency(trx, tenantId, code, { name, symbol, decimals, isActive, isDefault }) {
  const normalized = code.toUpperCase();
  const row = await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: normalized }).first();
  if (!row) throw ApiError.notFound('Esa moneda no está configurada en el colegio.');
  const catalog = await trx('currencies').where({ code: normalized }).first();

  if (row.is_default && isActive === false) {
    throw ApiError.unprocessable('No se puede desactivar la moneda predeterminada: marca otra como predeterminada primero.', [
      { path: 'isActive', message: 'Es la predeterminada.' },
    ]);
  }
  if (row.is_default && isDefault === false) {
    throw ApiError.unprocessable('Siempre debe haber una moneda predeterminada: marca otra en su lugar.', [
      { path: 'isDefault', message: 'Marca otra.' },
    ]);
  }
  const willBeActive = isActive ?? row.is_active;
  if (isDefault && !willBeActive) {
    throw ApiError.unprocessable('Solo una moneda activa puede ser la predeterminada.', [{ path: 'isDefault', message: 'Actívala primero.' }]);
  }

  const patch = { ...overrides(catalog, { name, symbol, decimals }), updated_at: trx.fn.now() };
  if (isActive !== undefined) patch.is_active = isActive;
  await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: normalized }).update(patch);
  if (isDefault) await markDefault(trx, tenantId, normalized);
  return getCurrencyAdminItem(trx, tenantId, normalized);
}

/**
 * Quita una moneda del colegio. Solo si nunca se usó (sin tasas ni pagos):
 * si ya tiene historial, se desactiva para no perderlo.
 */
async function removeTenantCurrency(trx, tenantId, code) {
  const normalized = code.toUpperCase();
  const row = await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: normalized }).first();
  if (!row) throw ApiError.notFound('Esa moneda no está configurada en el colegio.');
  if (row.is_default) {
    throw ApiError.unprocessable('No se puede quitar la moneda predeterminada: marca otra como predeterminada primero.');
  }
  const hasRates = await trx('exchange_rates').where({ tenant_id: tenantId, quote_currency: normalized }).first();
  const hasPayments = await trx('payments')
    .where({ tenant_id: tenantId })
    .andWhere((q) => q.where('currency', normalized).orWhere('ref_currency', normalized))
    .first();
  if (hasRates || hasPayments) {
    throw ApiError.conflict('Esta moneda ya tiene tasas o pagos registrados: desactívala en lugar de quitarla, para conservar el historial.');
  }
  await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: normalized }).delete();
}

async function getCurrencyAdminItem(trx, tenantId, code) {
  const admin = await listCurrencyAdmin(trx, tenantId);
  return admin.currencies.find((c) => c.code === code);
}

// ---------------------------------------------------------------------------
// SQL de conversión de pagos (alias p)
// ---------------------------------------------------------------------------

/**
 * Joins que resuelven, para cada pago, la moneda en que se muestra y la tasa
 * vigente de esa moneda. Uso: `query.joinRaw(sql, bindings)`.
 *
 * Moneda de cada pago (rc.code):
 *   1. confirmado con conversión guardada → la moneda de esa foto;
 *   2. cobro que no es en USD (ej. un cargo en Bs) → su propia moneda;
 *   3. pendiente en USD → la que pide la vista (`viewCurrency`), o la que
 *      eligió la familia al reportarlo, o la predeterminada del colegio.
 */
function conversionJoins(viewCurrency = null) {
  return {
    sql: `
      LEFT JOIN LATERAL (
        SELECT CASE
          WHEN p.ref_amount IS NOT NULL THEN p.ref_currency
          WHEN p.currency <> '${BASE}' THEN p.currency
          ELSE COALESCE(
            ?::varchar,
            p.ref_currency,
            (SELECT tc.currency_code FROM tenant_currencies tc WHERE tc.tenant_id = p.tenant_id AND tc.is_default),
            '${LEGACY_DEFAULT}'
          )
        END AS code
      ) rc ON true
      LEFT JOIN currencies rcur ON rcur.code = rc.code
      -- Decimales personalizados por el colegio (migración 011), si los hay.
      LEFT JOIN tenant_currencies rtc ON rtc.tenant_id = p.tenant_id AND rtc.currency_code = rc.code
      LEFT JOIN LATERAL (
        SELECT er.rate, er.rate_date
        FROM exchange_rates er
        WHERE er.tenant_id = p.tenant_id AND er.base_currency = '${BASE}' AND er.quote_currency = rc.code
          AND er.rate_date <= current_date
        ORDER BY er.rate_date DESC
        LIMIT 1
      ) cr ON true`,
    bindings: [viewCurrency],
  };
}

/**
 * Columnas conv_* (requieren `conversionJoins`):
 *   conv_currency   moneda en que se expresa el equivalente
 *   conv_amount     monto en esa moneda (foto al confirmar, o estimado con la tasa vigente)
 *   conv_rate       tasa aplicada (null si no hubo conversión)
 *   conv_rate_date  fecha valor de esa tasa
 *   conv_estimated  true si es un estimado (pendiente): cambia si cambia la tasa
 * conv_amount es null si hace falta una tasa que no está registrada.
 */
const CONV_SELECT = [
  'rc.code AS conv_currency',
  `CASE WHEN p.ref_amount IS NOT NULL THEN p.ref_amount
        WHEN rc.code = p.currency THEN p.amount
        WHEN cr.rate IS NOT NULL THEN round(p.amount * cr.rate, COALESCE(rtc.decimals, rcur.decimals))::numeric(18,2)
   END AS conv_amount`,
  'CASE WHEN p.ref_amount IS NOT NULL THEN p.ref_rate WHEN rc.code = p.currency THEN NULL ELSE cr.rate END AS conv_rate',
  'CASE WHEN p.ref_amount IS NOT NULL THEN p.ref_rate_date WHEN rc.code = p.currency THEN NULL ELSE cr.rate_date END AS conv_rate_date',
  '(p.ref_amount IS NULL AND rc.code <> p.currency) AS conv_estimated',
];

/**
 * Totales en UNA moneda (`target`), para tarjetas y resúmenes. Por pago:
 * cobro en esa moneda → su monto; foto confirmada en esa moneda → la foto;
 * cobro en USD → convertido con la tasa vigente; otra moneda → null (no se
 * mezclan monedas sin tasa cruzada). Uso: joinRaw(targetRateJoin(target)) y
 * sumar con `sumTargetSql` (null si algún pago no se pudo convertir).
 */
function targetRateJoin(target) {
  return {
    sql: `
      LEFT JOIN currencies tcur ON tcur.code = ?
      LEFT JOIN tenant_currencies ttc ON ttc.tenant_id = p.tenant_id AND ttc.currency_code = tcur.code
      LEFT JOIN LATERAL (
        SELECT er.rate FROM exchange_rates er
        WHERE er.tenant_id = p.tenant_id AND er.base_currency = '${BASE}' AND er.quote_currency = tcur.code
          AND er.rate_date <= current_date
        ORDER BY er.rate_date DESC
        LIMIT 1
      ) tr ON true`,
    bindings: [target],
  };
}

const TARGET_AMOUNT_SQL = `
  CASE WHEN p.currency = tcur.code THEN p.amount
       WHEN p.ref_amount IS NOT NULL AND p.ref_currency = tcur.code THEN p.ref_amount
       WHEN p.currency = '${BASE}' AND tr.rate IS NOT NULL THEN round(p.amount * tr.rate, COALESCE(ttc.decimals, tcur.decimals))::numeric(18,2)
  END`;

/** Suma que se vuelve null si falta convertir algún pago (nunca un total parcial). */
const sumTargetSql = `CASE WHEN bool_or((${TARGET_AMOUNT_SQL}) IS NULL) THEN NULL ELSE sum(${TARGET_AMOUNT_SQL}) END`;

// ---------------------------------------------------------------------------
// Tasas
// ---------------------------------------------------------------------------

/** Tasa vigente de `currency` en `onDate` ('YYYY-MM-DD'; por defecto hoy según la base) o null. */
async function getEffectiveRate(trx, tenantId, currency, onDate = null) {
  const query = trx('exchange_rates')
    .where({ tenant_id: tenantId, base_currency: BASE, quote_currency: currency })
    .orderBy('rate_date', 'desc')
    .select('id', 'rate', 'rate_date', 'source', 'updated_at')
    .first();
  if (onDate) query.andWhere('rate_date', '<=', onDate);
  else query.andWhereRaw('rate_date <= current_date');
  const row = await query;
  return row ? { ...row, rate: Number(row.rate) } : null;
}

/**
 * Estado de las tasas para la interfaz: por cada moneda activa, la tasa
 * vigente, la próxima (fecha valor futura) y si está desactualizada.
 * `current`/`next`/`stale` en la raíz corresponden a la predeterminada.
 */
async function getRateStatus(trx, tenantId, { includeInactive = false } = {}) {
  const enabled = await getTenantCurrencies(trx, tenantId, { includeInactive });
  const { rows } = await trx.raw('SELECT current_date::text AS today');
  const today = rows[0].today;
  const codes = enabled.map((c) => c.code);

  const rates = codes.length
    ? await trx('exchange_rates')
        .where({ tenant_id: tenantId, base_currency: BASE })
        .whereIn('quote_currency', codes)
        .select('quote_currency', 'rate', 'rate_date', 'source', 'updated_at')
        .orderBy('rate_date', 'desc')
    : [];

  const currencies = enabled.map((c) => {
    const mine = rates.filter((r) => r.quote_currency === c.code);
    const current = mine.find((r) => r.rate_date <= today) || null;
    const next = [...mine].reverse().find((r) => r.rate_date > today) || null;
    const ageDays = current ? Math.round((Date.parse(today) - Date.parse(current.rate_date)) / 86400000) : null;
    const pick = (r) => r && { rate: Number(r.rate), rate_date: r.rate_date, source: r.source, updated_at: r.updated_at };
    return {
      code: c.code,
      name: c.name,
      country: c.country,
      symbol: c.symbol,
      decimals: c.decimals,
      locale: c.locale,
      official_source: c.official_source,
      is_default: c.is_default,
      is_active: c.is_active,
      current: pick(current),
      next: pick(next),
      stale: current ? ageDays > STALE_AFTER_DAYS : true,
      age_days: ageDays,
    };
  });
  const def = currencies.find((c) => c.is_default) || currencies.find((c) => c.is_active) || currencies[0];

  return {
    base: BASE,
    today,
    default_currency: def.code,
    currencies,
    // Atajos de la moneda predeterminada (compatibilidad con la vista anterior).
    quote: def.code,
    current: def.current,
    next: def.next,
    stale: def.stale,
    age_days: def.age_days,
  };
}

/** Moneda configurada en el colegio (activa o no): para consultar su historial. */
async function assertConfiguredCurrency(trx, tenantId, code) {
  const normalized = String(code).trim().toUpperCase();
  const all = await getTenantCurrencies(trx, tenantId, { includeInactive: true });
  if (!all.some((c) => c.code === normalized)) {
    throw ApiError.badRequest(`El colegio no tiene configurada la moneda ${normalized}.`, [{ path: 'currency', message: 'No configurada.' }]);
  }
  return normalized;
}

async function listRates(trx, tenantId, { currency, limit = 30 } = {}) {
  const code = currency ? await assertConfiguredCurrency(trx, tenantId, currency) : await getDefaultCurrency(trx, tenantId);
  const rows = await trx('exchange_rates as er')
    .leftJoin('users as u', 'u.id', 'er.created_by')
    .where({ 'er.tenant_id': tenantId, 'er.base_currency': BASE, 'er.quote_currency': code })
    .select('er.id', 'er.quote_currency as currency', 'er.rate', 'er.rate_date', 'er.source', 'er.updated_at', 'u.full_name as created_by_name')
    .orderBy('er.rate_date', 'desc')
    .limit(limit);
  return rows.map((r) => ({ ...r, rate: Number(r.rate) }));
}

/** Registra (o corrige) la tasa de una moneda para una fecha valor. */
async function upsertRate(trx, tenantId, { currency, rateDate, rate, source = 'manual' }, userId = null) {
  const code = currency ? await assertRefCurrency(trx, tenantId, currency) : await getDefaultCurrency(trx, tenantId);
  if (code === BASE) throw ApiError.badRequest('El dólar es la moneda base: no lleva tasa.', [{ path: 'currency', message: 'No aplica.' }]);
  const { rows } = await trx.raw('SELECT (?::date > current_date + 7) AS too_far', [rateDate]);
  if (rows[0].too_far) {
    throw ApiError.badRequest('La fecha valor no puede ser más de 7 días posterior a hoy.', [
      { path: 'rateDate', message: 'Fecha demasiado lejana.' },
    ]);
  }
  await trx('exchange_rates')
    .insert({ tenant_id: tenantId, base_currency: BASE, quote_currency: code, rate_date: rateDate, rate, source, created_by: userId })
    .onConflict(['tenant_id', 'base_currency', 'quote_currency', 'rate_date'])
    .merge({ rate, source, created_by: userId, updated_at: trx.fn.now() });
  return getRateStatus(trx, tenantId);
}

/** Borra una tasa cargada por error, salvo que ya se haya usado en un pago confirmado. */
async function deleteRate(trx, tenantId, id) {
  const rate = await trx('exchange_rates').where({ id, tenant_id: tenantId }).first();
  if (!rate) throw ApiError.notFound('Tasa no encontrada.');
  const used = await trx('payments')
    .where({ tenant_id: tenantId, ref_currency: rate.quote_currency, ref_rate_date: rate.rate_date })
    .first();
  if (used) {
    throw ApiError.conflict('No se puede eliminar: ya se usó para confirmar pagos. Corrige el valor registrándola de nuevo.');
  }
  await trx('exchange_rates').where({ id }).delete();
}

// ---------------------------------------------------------------------------
// Consulta a la página del BCV (solo bolívar)
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

/** Consulta el BCV y guarda la tasa del bolívar publicada (con su fecha valor) para el colegio. */
async function updateFromBcv(trx, tenantId, userId = null) {
  await assertRefCurrency(trx, tenantId, 'VES');
  const { rate, rateDate } = await fetchBcvRate();
  const status = await upsertRate(trx, tenantId, { currency: 'VES', rateDate, rate, source: 'bcv' }, userId);
  return { fetched: { rate, rate_date: rateDate }, ...status };
}

module.exports = {
  BASE,
  listCurrencies,
  getCurrency,
  getTenantCurrencies,
  getDefaultCurrency,
  assertRefCurrency,
  setTenantCurrencies,
  listCurrencyAdmin,
  addTenantCurrency,
  updateTenantCurrency,
  removeTenantCurrency,
  conversionJoins,
  CONV_SELECT,
  targetRateJoin,
  TARGET_AMOUNT_SQL,
  sumTargetSql,
  getEffectiveRate,
  getRateStatus,
  listRates,
  upsertRate,
  deleteRate,
  parseBcvHtml,
  fetchBcvRate,
  updateFromBcv,
};
