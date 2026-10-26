const path = require('path');
const { ApiError } = require('../../utils/ApiError');
const { logAudit } = require('../../services/audit/audit.service');

/**
 * Eliminar una moneda del colegio JUNTO con todo lo registrado en ella
 * (pensado para limpiar monedas usadas en pruebas).
 *
 * Por qué no es un ON DELETE CASCADE de la base: los pagos y las tasas
 * apuntan al CATÁLOGO global de monedas (`currencies`, compartido por todos
 * los colegios), no a la configuración del colegio (`tenant_currencies`).
 * Quitar la moneda del colegio no borra el catálogo, así que una cascada no
 * dispararía; y ponerla en el catálogo borraría los pagos de esa moneda en
 * TODOS los colegios. Por eso el borrado se hace aquí, explícito, dentro de
 * la transacción del request (todo o nada) y solo en este colegio:
 *
 *   1. pagos asociados a la moneda:
 *        - cobros emitidos en esa moneda (currency = código), y
 *        - pagos en USD registrados o reportados en esa moneda (ref_currency);
 *   2. sus tasas de cambio;
 *   3. la moneda del colegio (tenant_currencies).
 *
 * Con registros asociados exige escribir el código de la moneda para
 * confirmar. Queda constancia en audit_logs. Los archivos de esos pagos
 * (comprobantes y recibos PDF) se devuelven para borrarlos DESPUÉS de
 * confirmar la transacción (si algo falla, no se pierde ningún archivo).
 */

const RECEIPTS_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'receipts');

const paymentsOf = (trx, tenantId, code) =>
  trx('payments')
    .where({ tenant_id: tenantId })
    .andWhere((q) => q.where('currency', code).orWhere('ref_currency', code));

async function loadTenantCurrency(trx, tenantId, rawCode) {
  const code = String(rawCode).trim().toUpperCase();
  const row = await trx('tenant_currencies as tc')
    .join('currencies as c', 'c.code', 'tc.currency_code')
    .where({ 'tc.tenant_id': tenantId, 'tc.currency_code': code })
    .select('c.code', trx.raw('COALESCE(tc.name, c.name) AS name'), 'tc.is_active', 'tc.is_default')
    .first();
  if (!row) throw ApiError.notFound('Esa moneda no está configurada en el colegio.');
  return row;
}

/**
 * Qué se eliminaría: { currency, rates, payments: { total, in_currency,
 * paid_with_currency, by_status }, files, needs_confirmation, blocked_reason }.
 */
async function getCurrencyDeletionImpact(trx, tenantId, rawCode) {
  const currency = await loadTenantCurrency(trx, tenantId, rawCode);
  const { code } = currency;
  const rates = Number((await trx('exchange_rates').where({ tenant_id: tenantId, quote_currency: code }).count('* as n').first()).n);
  const rows = await paymentsOf(trx, tenantId, code).select('currency', 'status', 'reported_at', 'proof_path', 'receipt_url');
  // Mismo criterio que la lista de pagos: un pendiente que la familia ya reportó se muestra como 'reported'.
  const byStatus = {};
  rows.forEach((p) => {
    const key = p.status === 'pending' && p.reported_at ? 'reported' : p.status;
    byStatus[key] = (byStatus[key] || 0) + 1;
  });
  const payments = {
    total: rows.length,
    in_currency: rows.filter((p) => p.currency === code).length,
    paid_with_currency: rows.filter((p) => p.currency !== code).length,
    by_status: byStatus,
    proofs: rows.filter((p) => p.proof_path).length,
    receipts: rows.filter((p) => p.receipt_url).length,
  };
  return {
    currency,
    rates,
    payments,
    needs_confirmation: rates + payments.total > 0,
    blocked_reason: currency.is_default ? 'Es la moneda predeterminada del colegio: marca otra como predeterminada antes de eliminarla.' : null,
  };
}

/**
 * Elimina la moneda y sus registros. `confirmCode`: el código de la moneda
 * (obligatorio si tiene tasas o pagos). Devuelve el resumen y `files`
 * (rutas a borrar tras el commit).
 */
async function deleteTenantCurrencyCascade(trx, tenantId, rawCode, { confirmCode, userId = null } = {}) {
  const impact = await getCurrencyDeletionImpact(trx, tenantId, rawCode);
  const { code } = impact.currency;
  if (impact.blocked_reason) {
    throw ApiError.unprocessable(`No se puede eliminar ${impact.currency.name} (${code}). ${impact.blocked_reason}`);
  }
  if (impact.needs_confirmation) {
    if (!confirmCode) {
      throw ApiError.conflict(
        `${impact.currency.name} (${code}) tiene ${impact.rates} tasa(s) y ${impact.payments.total} pago(s) registrados. Para eliminarla junto con ellos, confirma escribiendo el código ${code}.`,
        [{ path: 'confirmCode', message: 'Confirmación requerida.' }]
      );
    }
    if (String(confirmCode).trim().toUpperCase() !== code) {
      throw ApiError.badRequest(`Para confirmar, escribe exactamente el código de la moneda: ${code}.`, [{ path: 'confirmCode', message: 'No coincide.' }]);
    }
  }

  // Bloquea la moneda del colegio mientras se borra (nadie registra un pago a la vez).
  await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: code }).forUpdate();

  const payments = await paymentsOf(trx, tenantId, code).select('id', 'proof_path', 'receipt_url', 'status', 'amount', 'currency', 'ref_amount', 'period_label');
  const files = [
    ...payments.filter((p) => p.proof_path).map((p) => ({ kind: 'proof', path: p.proof_path })),
    ...payments.filter((p) => p.receipt_url).map((p) => ({ kind: 'receipt', path: path.join(RECEIPTS_DIR, `${p.id}.pdf`) })),
  ];

  const deletedPayments = payments.length ? await trx('payments').whereIn('id', payments.map((p) => p.id)).delete() : 0;
  const deletedRates = await trx('exchange_rates').where({ tenant_id: tenantId, quote_currency: code }).delete();
  await trx('tenant_currencies').where({ tenant_id: tenantId, currency_code: code }).delete();

  await logAudit(trx, {
    tenantId,
    userId,
    action: 'ELIMINAR_MONEDA',
    module: 'payments',
    entity: 'tenant_currencies',
    summary: `Eliminó la moneda ${impact.currency.name} (${code}) con ${deletedPayments} pago(s) y ${deletedRates} tasa(s)`,
    diff: {
      currency: code,
      name: impact.currency.name,
      deleted: { payments: deletedPayments, exchange_rates: deletedRates, files: files.length },
      payments: payments.map((p) => ({ id: p.id, status: p.status, amount: p.amount, currency: p.currency, ref_amount: p.ref_amount, period_label: p.period_label })),
    },
  });

  return {
    deleted: true,
    currency: impact.currency,
    deleted_payments: deletedPayments,
    deleted_rates: deletedRates,
    deleted_files: files.length,
    files,
  };
}

module.exports = { getCurrencyDeletionImpact, deleteTenantCurrencyCascade };
