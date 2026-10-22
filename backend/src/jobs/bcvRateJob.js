const { db, withTenantTransaction } = require('../config/database');
const bcvSync = require('../modules/payments/bcvSync.service');

/**
 * Actualización automática de la tasa oficial del BCV.
 *
 * ACTIVA por defecto (BCV_AUTO_UPDATE=false la desactiva). Corre a horas
 * FIJAS, en hora de Venezuela: BCV_SYNC_TIMES (por defecto 09:00, 13:00 y
 * 17:00). Además corre una vez poco después de arrancar el servidor, por si
 * estuvo apagado a la hora programada. La tasa se obtiene UNA vez por corrida
 * y se guarda en cada colegio activo que usa el bolívar; si es una tasa nueva,
 * se avisa en la campana a la administración y a los representantes.
 *
 * Si la consulta falla, la tasa vigente anterior sigue aplicándose, el motivo
 * queda registrado en cada colegio (la administración lo ve en el panel de
 * tasas) y se reintenta en la siguiente corrida.
 */
let running = false;

/**
 * Colegios activos que usan el bolívar (los que no configuraron monedas lo usan
 * por defecto). tenant_currencies es una tabla DEL COLEGIO: con esquemas por
 * colegio se consulta dentro de la transacción de cada uno (search_path), no
 * con una sola consulta sobre public.
 */
async function vesTenants() {
  const candidates = await db('tenants').whereIn('status', ['active', 'trial']).pluck('id');
  const result = [];
  for (const id of candidates) {
    try {
      const usesVes = await withTenantTransaction(id, async (trx) => {
        const rows = await trx('tenant_currencies').where({ tenant_id: id }).select('currency_code', 'is_active');
        return rows.length === 0 || rows.some((r) => r.currency_code === 'VES' && r.is_active);
      });
      if (usesVes) result.push(id);
    } catch (err) {
      console.error(`[bcv] No se pudieron leer las monedas del colegio ${id}:`, err.message);
    }
  }
  return result;
}

async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  try {
    const tenants = await vesTenants();
    if (!tenants.length) return { tenants: 0 };
    let fetched;
    try {
      fetched = await bcvSync.fetchOfficialRate();
    } catch (err) {
      console.error('[bcv] No se pudo obtener la tasa:', err.message);
      for (const id of tenants) await bcvSync.recordFailure(id, err.message, 'auto');
      return { tenants: tenants.length, saved: 0, error: err.message };
    }
    let saved = 0;
    for (const id of tenants) {
      try {
        await withTenantTransaction(id, (trx) => bcvSync.applyRate(trx, id, fetched, { trigger: 'auto' }));
        saved += 1;
      } catch (err) {
        console.error(`[bcv] No se pudo guardar la tasa del colegio ${id}:`, err.message);
        await bcvSync.recordFailure(id, err.message, 'auto');
      }
    }
    console.log(`[bcv] Tasa ${fetched.rate} Bs/USD (fecha valor ${fetched.rateDate}, origen ${fetched.source}) guardada en ${saved}/${tenants.length} colegio(s).`);
    return { tenants: tenants.length, saved, fetched };
  } catch (err) {
    console.error('[bcv] Error en la actualización automática:', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

let timer = null;

/** Programa la próxima corrida a la siguiente hora fija (y así sucesivamente). */
function scheduleNext() {
  const ms = bcvSync.msUntilNextRun();
  timer = setTimeout(async () => {
    await runOnce();
    scheduleNext();
  }, ms);
  timer.unref(); // no impide que el proceso termine
  return new Date(Date.now() + ms);
}

function startBcvRateJob() {
  const { enabled, times } = bcvSync.autoConfig();
  if (!enabled) {
    console.log('[bcv] Actualización automática desactivada (BCV_AUTO_UPDATE=false).');
    return null;
  }
  // Corrida inicial unos segundos después de arrancar (no retrasa el inicio del servidor).
  const first = setTimeout(runOnce, 15 * 1000);
  first.unref();
  const next = scheduleNext();
  console.log(`[bcv] Actualización automática a las ${times.join(', ')} (hora de Venezuela). Próxima: ${next.toISOString()}.`);
  return { next };
}

function stopBcvRateJob() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startBcvRateJob, stopBcvRateJob, runOnce };
