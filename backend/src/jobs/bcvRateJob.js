const { db, withTenantTransaction } = require('../config/database');
const exchange = require('../modules/payments/exchangeRate.service');

/**
 * Actualización automática de la tasa BCV (opcional).
 * Se activa con BCV_AUTO_UPDATE=true; consulta la página del BCV al iniciar y
 * cada BCV_UPDATE_INTERVAL_HOURS horas (6 por defecto) y guarda la tasa con su
 * fecha valor en cada colegio activo. Si el BCV no responde o cambió su página,
 * solo registra el error: la tasa vigente anterior sigue aplicándose y el
 * administrador puede cargarla a mano.
 */
async function runOnce() {
  let fetched;
  try {
    fetched = await exchange.fetchBcvRate();
  } catch (err) {
    console.error('[bcv] No se pudo obtener la tasa:', err.message);
    return;
  }
  const tenants = await db('tenants').whereIn('status', ['active', 'trial']).select('id');
  for (const t of tenants) {
    try {
      await withTenantTransaction(t.id, (trx) =>
        exchange.upsertRate(trx, t.id, { rateDate: fetched.rateDate, rate: fetched.rate, source: 'bcv' })
      );
    } catch (err) {
      console.error(`[bcv] No se pudo guardar la tasa del colegio ${t.id}:`, err.message);
    }
  }
  console.log(`[bcv] Tasa ${fetched.rate} Bs/USD (fecha valor ${fetched.rateDate}) guardada en ${tenants.length} colegio(s).`);
}

function startBcvRateJob() {
  if (process.env.BCV_AUTO_UPDATE !== 'true') return null;
  const hours = Number(process.env.BCV_UPDATE_INTERVAL_HOURS) || 6;
  runOnce();
  const timer = setInterval(runOnce, hours * 3600 * 1000);
  timer.unref(); // no impide que el proceso termine
  console.log(`[bcv] Actualización automática activada cada ${hours} h.`);
  return timer;
}

module.exports = { startBcvRateJob, runOnce };
