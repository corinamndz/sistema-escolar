const { withTenantTransaction } = require('../../config/database');
const { ApiError } = require('../../utils/ApiError');
const exchange = require('./exchangeRate.service');
const bcvClient = require('../../services/bcv/bcvClient');
const notifications = require('../notifications/notification.service');
const { notify } = require('../notifications/notify');
const notificationPrefs = require('../notifications/notificationPreferences.service');

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
 * BCV_SYNC_TIMES="09:00,13:00,17:00" por defecto. 09:00 y 13:00 recogen la
 * tasa vigente; 17:00 recoge la que el BCV publica por la tarde para el
 * siguiente día hábil (así la familia la conoce antes). Entradas inválidas se
 * ignoran; si no queda ninguna, se usan las predeterminadas.
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
 */
async function applyRate(trx, tenantId, fetched, { userId = null, trigger = 'auto' } = {}) {
  await exchange.assertRefCurrency(trx, tenantId, 'VES');
  await assertPlausible(trx, tenantId, fetched.rate, fetched.rateDate);
  const vesRates = () => trx('exchange_rates').where({ tenant_id: tenantId, base_currency: exchange.BASE, quote_currency: 'VES' });
  const before = await vesRates().andWhere('rate_date', fetched.rateDate).first('rate');
  const previous = await vesRates().andWhere('rate_date', '<', fetched.rateDate).orderBy('rate_date', 'desc').first('rate');
  const status = await exchange.upsertRate(trx, tenantId, { currency: 'VES', rateDate: fetched.rateDate, rate: fetched.rate, source: fetched.source }, userId);
  // Solo una tasa NUEVA (o corregida) genera aviso: consultar varias veces al día la misma no notifica de nuevo.
  if (!before || Number(before.rate) !== fetched.rate) {
    await notifyNewRate(trx, tenantId, fetched, { previousRate: previous ? Number(previous.rate) : null, today: status.today });
  }
  await recordAttempt(trx, tenantId, {
    last_status: 'ok',
    last_error: null,
    last_success_at: trx.fn.now(),
    last_source: fetched.source,
    last_rate: fetched.rate,
    last_rate_date: fetched.rateDate,
    last_trigger: trigger,
  });
  return status;
}

/** 880.1159 → "880,1159" (formato venezolano, 2 a 4 decimales). */
const formatVes = (rate) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(rate);
/** '2026-10-16' → '16/10/2026' */
const dmy = (d) => d.split('-').reverse().join('/');

/**
 * Aviso en la campana para la administración (quien gestiona pagos) y para
 * los representantes: "Nueva tasa BCV actualizada: 880,1159 Bs/USD (Fecha: 16/10/2026)".
 * Al abrirlo, la administración va a Pagos y la familia a Mis pagos.
 */
async function notifyNewRate(trx, tenantId, fetched, { previousRate, today, simulated = false, audience = ['staff', 'guardians'] }) {
  // Campana y/o correo según Configuración → Notificaciones (la simulación: solo campana).
  const { bell } = await notify(trx, tenantId, {
    event: 'bcv_rate',
    allGuardians: audience.includes('guardians'),
    alsoStaff: audience.includes('guardians'),
    staffOnly: !audience.includes('guardians'),
    skipEmail: simulated,
    title: simulated ? 'Nueva tasa BCV (prueba)' : 'Nueva tasa BCV',
    body: `${simulated ? '[Prueba] ' : ''}Nueva tasa BCV actualizada: ${formatVes(fetched.rate)} Bs/USD (Fecha: ${dmy(fetched.rateDate)})`,
    // Las simulaciones no se deduplican: cada prueba genera su aviso.
    dedupeKey: simulated ? null : `bcv_rate:VES:${fetched.rateDate}:${fetched.rate}`,
    data: {
      simulated,
      currency: 'VES',
      rate: fetched.rate,
      rate_date: fetched.rateDate,
      previous_rate: previousRate,
      source: fetched.source,
      effective_now: fetched.rateDate <= today,
    },
    links: { staff: '/payments', guardians: '/payments/mine' },
  });
  return bell;
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
    const status = await trx.transaction((sp) => applyRate(sp, tenantId, fetched, { userId, trigger: 'manual' }));
    return { fetched: { rate: fetched.rate, rate_date: fetched.rateDate, source: fetched.source }, ...status, sync: await getSyncStatus(trx, tenantId) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    await recordFailure(tenantId, err.message, 'manual');
    throw ApiError.unprocessable(err.message);
  }
}

module.exports = { fetchOfficialRate, parseFallbackJson, applyRate, recordFailure, getSyncStatus, syncNow, autoConfig, msUntilNextRun, syncTimes, simulateRateUpdate, clearSimulations };
