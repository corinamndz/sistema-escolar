const { withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const exchange = require('./exchangeRate.service');
const bcvClient = require('../../services/bcv/bcvClient');
const notifications = require('../notifications/notification.service');
const { notify } = require('../notifications/notify');
const notificationPrefs = require('../notifications/notificationPreferences.service');
const tuitionImpact = require('./tuitionImpact.service');

/**
 * Sincronización automática de la tasa oficial del BCV (bolívar por 1 USD).
 *
 * Fuentes, en orden:
 *   1. www.bcv.org.ve (BCV_URL) — la fuente oficial. Su servidor envía la
 *      cadena de certificados incompleta: bcvClient la completa sin
 *      desactivar la verificación TLS.
 *   2. Respaldo (BCV_FALLBACK_URL, por defecto ve.dolarapi.com): API pública
 *      que replica la tasa oficial del BCV. Solo se usa si la página del BCV
 *      falla; la tasa queda registrada con origen 'bcv_api' para que se sepa.
 *      BCV_FALLBACK_URL= (vacío) lo desactiva.
 *
 * Cada intento queda en exchange_rate_sync (último intento, último éxito,
 * último error) para que la administración vea si la actualización
 * automática está funcionando.
 */

const DEFAULT_FALLBACK_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';
const MAX_JUMP = 0.3; // una variación mayor al 30 % frente a la tasa reciente se considera un dato erróneo
const RECENT_DAYS = 45; // solo se compara con tasas de las últimas semanas

const bcvUrl = () => process.env.BCV_URL || 'https://www.bcv.org.ve/';
const fallbackUrl = () => (process.env.BCV_FALLBACK_URL === undefined ? DEFAULT_FALLBACK_URL : process.env.BCV_FALLBACK_URL.trim());

// ---------------------------------------------------------------------------
// Horario de la tarea automática
// ---------------------------------------------------------------------------

/**
 * Horas fijas del día (hora de Venezuela) en que se consulta la tasa:
 * BCV_SYNC_TIMES="09:00,13:00,17:00" por defecto. Cada consulta que obtiene un
 * valor nuevo lo aplica en ese momento (ver applyRate): la de las 17:00 recoge
 * la que el BCV publica por la tarde y rige desde entonces. Entradas inválidas
 * se ignoran; si no queda ninguna, se usan las predeterminadas.
 */
const DEFAULT_TIMES = ['09:00', '13:00', '17:00'];
const TIMEZONE = 'America/Caracas';

function syncTimes() {
  const raw = (process.env.BCV_SYNC_TIMES || '').split(',').map((t) => t.trim());
  const valid = [...new Set(raw.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].sort();
  return valid.length ? valid : DEFAULT_TIMES;
}

/** Hora actual (en minutos desde medianoche, con fracción) en la zona indicada. */
function wallMinutes(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)])
  );
  return parts.hour * 60 + parts.minute + parts.second / 60 + now.getMilliseconds() / 60000;
}

/**
 * Milisegundos hasta la próxima hora programada (Venezuela no tiene horario
 * de verano: el cálculo es exacto todo el año).
 */
function msUntilNextRun(now = new Date(), times = syncTimes(), timeZone = TIMEZONE) {
  const current = wallMinutes(now, timeZone);
  const slots = times.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  const next = slots.find((m) => m > current + 1 / 120) ?? slots[0] + 24 * 60; // +0,5 s de margen
  return Math.max(1000, Math.round((next - current) * 60000));
}

/** Configuración de la tarea automática (la lee también la interfaz). */
function autoConfig() {
  const enabled = process.env.BCV_AUTO_UPDATE !== 'false';
  return {
    enabled,
    times: syncTimes(),
    timezone: TIMEZONE,
    next_run_at: enabled ? new Date(Date.now() + msUntilNextRun()).toISOString() : null,
    fallback_enabled: Boolean(fallbackUrl()),
    simulation_enabled: simulationEnabled(),
  };
}

/**
 * Respuesta de la API de respaldo:
 * { moneda: 'USD', fuente: 'oficial', promedio: 880.1159, fechaActualizacion: '2026-10-16T00:00:00-04:00' }
 * `fechaActualizacion` es la fecha valor publicada por el BCV.
 */
function parseFallbackJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('La API de respaldo no devolvió JSON.');
  }
  const rate = Number(data?.promedio);
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(String(data?.fechaActualizacion || ''));
  if (data?.moneda !== 'USD' || data?.fuente !== 'oficial') throw new Error('La API de respaldo no devolvió la tasa oficial del dólar.');
  if (!Number.isFinite(rate) || rate <= 0 || !date) throw new Error('La API de respaldo devolvió una tasa o fecha inválida.');
  return { rate, rateDate: date[1] };
}

/**
 * Tasa oficial publicada: { rate, rateDate, source: 'bcv' | 'bcv_api' }.
 * Lanza un Error con el motivo de cada fuente si ninguna respondió.
 */
async function fetchOfficialRate({ timeoutMs = 15000 } = {}) {
  let bcvError;
  try {
    const html = await bcvClient.getTextCompletingChain(bcvUrl(), { timeoutMs });
    return { ...exchange.parseBcvHtml(html), source: 'bcv' };
  } catch (err) {
    bcvError = err.message;
  }
  const fallback = fallbackUrl();
  if (!fallback) throw new Error(`Página del BCV: ${bcvError}`);
  try {
    const text = await bcvClient.getText(fallback, { timeoutMs, headers: { Accept: 'application/json' } });
    return { ...parseFallbackJson(text), source: 'bcv_api' };
  } catch (err) {
    throw new Error(`Página del BCV: ${bcvError} · Respaldo: ${err.message}`);
  }
}

/** Rechaza un valor que se aleja demasiado de la tasa reciente (página cambiada, error de la fuente…). */
async function assertPlausible(trx, tenantId, rate, rateDate) {
  const prev = await trx('exchange_rates')
    .where({ tenant_id: tenantId, base_currency: exchange.BASE, quote_currency: 'VES' })
    .andWhere('rate_date', '<', rateDate)
    .andWhereRaw('rate_date >= ?::date - ?::int', [rateDate, RECENT_DAYS])
    .orderBy('rate_date', 'desc')
    .first();
  if (!prev) return;
  const change = Math.abs(rate - Number(prev.rate)) / Number(prev.rate);
  if (change > MAX_JUMP) {
    throw new Error(
      `La tasa obtenida (${rate}) varía ${Math.round(change * 100)} % frente a la anterior (${Number(prev.rate)}): no se guardó por seguridad. Verifícala y regístrala manualmente.`
    );
  }
}

/**
 * ¿Existe la tabla de estado (migración 030)? Mientras no se migre, la tasa
 * se sigue guardando y el panel funciona, solo que sin el historial de intentos.
 */
let syncTableReady = false;
async function hasSyncTable(trx) {
  if (syncTableReady) return true;
  const { rows } = await trx.raw("SELECT to_regclass('exchange_rate_sync') IS NOT NULL AS ok");
  syncTableReady = rows[0].ok;
  return syncTableReady;
}

/** Guarda el resultado del intento en exchange_rate_sync (un registro por colegio). */
async function recordAttempt(trx, tenantId, row) {
  if (!(await hasSyncTable(trx))) return;
  const data = { tenant_id: tenantId, last_attempt_at: trx.fn.now(), ...row };
  await trx('exchange_rate_sync').insert(data).onConflict('tenant_id').merge();
}

/** Registra un fallo en SU PROPIA transacción: sobrevive al rollback del request que falló. */
async function recordFailure(tenantId, message, trigger) {
  try {
    await withTenantTransaction(tenantId, (trx) =>
      recordAttempt(trx, tenantId, { last_status: 'error', last_error: String(message).slice(0, 500), last_trigger: trigger })
    );
  } catch (err) {
    console.error(`[bcv] No se pudo registrar el fallo del colegio ${tenantId}:`, err.message);
  }
}

/**
 * Guarda una tasa ya obtenida en el colegio (si usa el bolívar) y registra el
 * éxito. Lanza Error si el colegio no usa VES o el valor no es plausible.
 *
 * Regla del colegio: la tasa obtenida RIGE DESDE EL MOMENTO DE LA CONSULTA, no
 * desde la "fecha valor" que publica el BCV (normalmente el día hábil
 * siguiente). Se registra con la fecha de hoy (hora de Venezuela), así todas
 * las conversiones (cuotas pendientes, cobros, equivalentes) la usan desde la
 * próxima consulta; `updated_at` guarda la hora exacta. Los pagos ya
 * confirmados no cambian: cada uno guarda la tasa con que se confirmó.
 * La fecha valor del BCV queda como referencia en el aviso (`bcv_value_date`).
 * Las tasas registradas a mano conservan la fecha valor que se les indique.
 */
async function applyRate(trx, tenantId, fetched, { userId = null, trigger = 'auto' } = {}) {
  await exchange.assertRefCurrency(trx, tenantId, 'VES');
  const { rows } = await trx.raw("SELECT current_date::text AS today, to_char(now(), 'HH24:MI') AS at");
  const { today, at } = rows[0];
  await assertPlausible(trx, tenantId, fetched.rate, today);
  const vesRates = () => trx('exchange_rates').where({ tenant_id: tenantId, base_currency: exchange.BASE, quote_currency: 'VES' });
  const inForce = await vesRates().andWhere('rate_date', '<=', today).orderBy('rate_date', 'desc').first('rate');
  // Tasas del BCV que la regla anterior dejó programadas para días futuros: esta las reemplaza
  // (si no, al llegar su fecha volverían a regir sobre la consultada hoy). Las manuales no se tocan.
  await vesRates().whereIn('source', ['bcv', 'bcv_api']).andWhere('rate_date', '>', today).delete();
  const status = await exchange.upsertRate(trx, tenantId, { currency: 'VES', rateDate: today, rate: fetched.rate, source: fetched.source }, userId);
  // Solo una tasa distinta de la vigente genera aviso: consultar varias veces al día la misma no notifica de nuevo.
  if (!inForce || Number(inForce.rate) !== fetched.rate) {
    await notifyNewRate(trx, tenantId, { ...fetched, rateDate: today, bcvValueDate: fetched.rateDate, at }, { previousRate: inForce ? Number(inForce.rate) : null, today });
  }
  await recordAttempt(trx, tenantId, {
    last_status: 'ok',
    last_error: null,
    last_success_at: trx.fn.now(),
    last_source: fetched.source,
    last_rate: fetched.rate,
    last_rate_date: today,
    last_trigger: trigger,
  });
  return { ...status, effective: { rate_date: today, at, bcv_value_date: fetched.rateDate } };
}

/** 880.1159 → "880,1159" (formato venezolano, 2 a 4 decimales). */
const formatVes = (rate) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate);
/** '2026-10-16' → '16/10/2026' */
const dmy = (d) => d.split('-').reverse().join('/');
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
/** '2026-10-20' → 'martes 20/10/2026' */
const dayDmy = (d) => `${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${dmy(d)}`;

/**
 * Desde cuándo rige. La tasa del BCV rige desde la consulta: "vigente desde hoy
 * 20/10/2026 a las 15:42". Una fecha futura (tasa manual programada) se anuncia
 * con el día: "vigente desde el martes 20/10/2026; hasta entonces rige …".
 */
function effectiveText(rateDate, today, currentRate, at = null) {
  if (rateDate <= today) return rateDate === today ? `vigente desde hoy ${dmy(rateDate)}${at ? ` a las ${at}` : ''}` : `vigente desde el ${dmy(rateDate)}`;
  return `vigente desde el ${dayDmy(rateDate)}${currentRate ? `; hasta entonces rige ${formatVes(currentRate)} Bs/USD` : ''}`;
}

/**
 * Aviso en la campana para la administración (quien gestiona pagos) y para
 * los representantes: "Nueva tasa BCV: 881,8769 Bs/USD, vigente desde hoy
 * 20/10/2026 a las 15:42 (antes: 881,0664 Bs/USD). Mensualidad 2026-2027:
 * $120,00 = Bs 105.825,23.". Al abrirlo, la administración va a Pagos y la
 * familia a Mis pagos.
 *
 * Impacto en la mensualidad (tuitionImpact.service): las tarifas del año en
 * curso convertidas con la tasa nueva viajan en `data.tuition`; la campana
 * muestra a cada representante el monto de SUS alumnos (se arma al leer el
 * aviso) y su correo lleva ese mismo desglose.
 */
async function notifyNewRate(trx, tenantId, fetched, { previousRate, today, simulated = false, audience = ['staff', 'guardians'] }) {
  // El impacto es informativo: si falla, el aviso sale igual (sin desglose) y la tasa se registra.
  let tuition = null;
  let emailExtra = null;
  try {
    tuition = await tuitionImpact.feeTable(trx, tenantId, fetched.rate);
    if (!simulated && tuition && audience.includes('guardians')) emailExtra = await familyEmailTexts(trx, tenantId, tuition);
  } catch (err) {
    console.error(`[bcv] No se pudo calcular el impacto en la mensualidad del colegio ${tenantId}:`, err.message);
  }
  const rateText = `${simulated ? '[Prueba] ' : ''}Nueva tasa BCV: ${formatVes(fetched.rate)} Bs/USD, ${effectiveText(fetched.rateDate, today, previousRate, fetched.at)}${
    fetched.rateDate <= today && previousRate ? ` (antes: ${formatVes(previousRate)} Bs/USD)` : ''
  }.`;
  const withTuition = tuition ? `${rateText} ${tuitionImpact.summaryText(tuition)}` : rateText;
  // Campana y/o correo según Configuración → Notificaciones (la simulación: solo campana).
  const { bell } = await notify(trx, tenantId, {
    event: 'bcv_rate',
    allGuardians: audience.includes('guardians'),
    alsoStaff: audience.includes('guardians'),
    staffOnly: !audience.includes('guardians'),
    skipEmail: simulated,
    title: simulated ? 'Nueva tasa BCV (prueba)' : 'Nueva tasa BCV',
    // El aviso admite 500 caracteres: si el resumen por nivel no cabe, va solo en el detalle.
    body: withTuition.length <= 500 ? withTuition : rateText,
    emailExtra,
    // Las simulaciones no se deduplican: cada prueba genera su aviso.
    dedupeKey: simulated ? null : `bcv_rate:VES:${fetched.rateDate}:${fetched.rate}`,
    data: {
      simulated,
      currency: 'VES',
      rate: fetched.rate,
      rate_date: fetched.rateDate,
      effective_at: fetched.at || null,
      // Fecha valor que publicó el BCV (referencia: el colegio aplica la tasa desde la consulta).
      bcv_value_date: fetched.bcvValueDate || null,
      previous_rate: previousRate,
      source: fetched.source,
      effective_now: fetched.rateDate <= today,
      // Mensualidad del año en curso con esta tasa (por nivel); null si el colegio no tiene tarifas.
      tuition,
    },
    links: { staff: '/payments', guardians: '/payments/mine' },
  });
  return bell;
}

/** Correo de cada familia: la mensualidad de sus alumnos con la tasa nueva. */
async function familyEmailTexts(trx, tenantId, tuition) {
  const byGuardian = await tuitionImpact.tuitionByGuardian(trx, tenantId, tuition);
  const out = new Map();
  for (const [guardianId, items] of byGuardian) if (items.length) out.set(guardianId, tuitionImpact.familyText(items));
  return out;
}

// ---------------------------------------------------------------------------
// Simulación (pruebas de la campana)
// ---------------------------------------------------------------------------

/**
 * ¿Se permite simular? BCV_SIMULATION=true|false lo fuerza; si no se indica,
 * se permite fuera de producción (NODE_ENV !== 'production').
 */
function simulationEnabled() {
  if (process.env.BCV_SIMULATION === 'true') return true;
  if (process.env.BCV_SIMULATION === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * «Simular actualización BCV»: genera el aviso de una tasa nueva SIN
 * registrarla. La tasa vigente de verdad define los montos en bolívares de
 * las cuotas y se congela al confirmar pagos: una tasa inventada en
 * exchange_rates cambiaría montos reales de las familias. Por eso aquí solo
 * se prueba el flujo de notificaciones (mismo mensaje, mismos destinatarios,
 * mismo detalle), marcado como "[Prueba]".
 *
 *   rate      tasa simulada (por defecto, la vigente + 0,35 %)
 *   audience  'all' (administración y representantes) | 'staff'
 */
async function simulateRateUpdate(trx, tenantId, { rate, audience = 'all' } = {}) {
  if (!simulationEnabled()) throw ApiError.forbidden('La simulación está desactivada en este servidor (BCV_SIMULATION=false o producción).');
  const current = await exchange.getEffectiveRate(trx, tenantId, 'VES');
  const value = rate ?? Math.round((current ? current.rate * 1.0035 : 100) * 10000) / 10000;
  const { rows } = await trx.raw('SELECT current_date::text AS today');
  const { today } = rows[0];
  if (!(await notificationPrefs.isEnabled(trx, tenantId, 'bcv_rate', 'bell'))) {
    throw ApiError.unprocessable('La campana está desactivada para «Nueva tasa BCV» en Configuración → Notificaciones: actívala para simular el aviso.');
  }
  const target = audience === 'staff' ? ['staff'] : ['staff', 'guardians'];
  const notification = await notifyNewRate(
    trx,
    tenantId,
    { rate: value, rateDate: today, source: 'simulated' },
    { previousRate: current ? current.rate : null, today, simulated: true, audience: target }
  );
  if (!notification) throw ApiError.unprocessable('Las notificaciones aún no están disponibles: ejecuta las migraciones (npm run migrate).');
  return {
    notification: { id: notification.id, body: notification.body, created_at: notification.created_at },
    rate: value,
    rate_date: today,
    recipients: await notifications.countRecipients(trx, tenantId, target),
  };
}

/** Borra los avisos de prueba del colegio. */
async function clearSimulations(trx, tenantId) {
  return { deleted: await notifications.deleteSimulated(trx, tenantId) };
}

/** Último intento del colegio + configuración de la tarea automática. */
async function getSyncStatus(trx, tenantId) {
  const row = (await hasSyncTable(trx)) ? await trx('exchange_rate_sync').where({ tenant_id: tenantId }).first() : null;
  return {
    auto: autoConfig(),
    last: row
      ? {
          attempt_at: row.last_attempt_at,
          success_at: row.last_success_at,
          status: row.last_status,
          error: row.last_error,
          source: row.last_source,
          rate: row.last_rate === null ? null : Number(row.last_rate),
          rate_date: row.last_rate_date,
          trigger: row.last_trigger,
        }
      : null,
  };
}

/**
 * Sincronización MANUAL ("Actualizar tasa ahora"). Si falla, el motivo queda
 * registrado aunque el request devuelva error.
 */
async function syncNow(trx, tenantId, userId) {
  await exchange.assertRefCurrency(trx, tenantId, 'VES');
  let fetched;
  try {
    fetched = await fetchOfficialRate();
  } catch (err) {
    await recordFailure(tenantId, err.message, 'manual');
    throw ApiError.unprocessable(`No se pudo obtener la tasa oficial. ${err.message} Puedes registrarla manualmente.`);
  }
  try {
    // SAVEPOINT: si el valor no es plausible, el request sigue usable.
    const { effective, ...status } = await trx.transaction((sp) => applyRate(sp, tenantId, fetched, { userId, trigger: 'manual' }));
    return {
      // rate_date = desde cuándo rige en el colegio (hoy); bcv_value_date = la fecha valor que publicó el BCV.
      fetched: { rate: fetched.rate, rate_date: effective.rate_date, effective_at: effective.at, bcv_value_date: effective.bcv_value_date, source: fetched.source },
      ...status,
      sync: await getSyncStatus(trx, tenantId),
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    await recordFailure(tenantId, err.message, 'manual');
    throw ApiError.unprocessable(err.message);
  }
}

module.exports = { fetchOfficialRate, parseFallbackJson, applyRate, recordFailure, getSyncStatus, syncNow, autoConfig, msUntilNextRun, syncTimes, simulateRateUpdate, clearSimulations };
