/**
 * Tarifas especiales por alumno (becas, convenios). Misma regla que el backend
 * (feePlan.service effectiveAmount / tuition.effectiveAmountSql):
 *   - 'percentage': descuento sobre la tarifa del nivel (100 % = exonerado);
 *   - 'fixed':      monto mensual fijo en USD.
 * Sin tarifa especial, el alumno paga la tarifa general de su nivel.
 */

export const FEE_PLAN_KINDS = {
  percentage: { label: 'Descuento (%)', hint: 'Becas y descuentos sobre la tarifa del nivel. 100 % = exonerado.' },
  fixed: { label: 'Monto fijo (USD)', hint: 'Convenios: el alumno paga este monto cada mes, sin importar su nivel.' },
};

export const GENERAL_FEE_LABEL = 'Tarifa general del nivel';

const num = (n) => new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 }).format(Number(n));
const usd = (n) => `$${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n))}`;

/** "50 % de descuento", "Exonerado (100 %)", "$80,00 fijos al mes". */
export function describeFeePlan(plan) {
  if (!plan) return GENERAL_FEE_LABEL;
  if (plan.kind === 'fixed') return `${usd(plan.amount)} fijos al mes`;
  return Number(plan.percentage) >= 100 ? 'Exonerado (100 %)' : `${num(plan.percentage)} % de descuento`;
}

/** Monto mensual con la tarifa `plan` sobre `base` (tarifa del nivel). null si no se puede calcular. */
export function effectiveFee(base, plan) {
  if (!plan) return base ?? null;
  if (plan.kind === 'fixed') return Number(plan.amount);
  if (base === null || base === undefined) return null;
  return Math.round(Number(base) * (100 - Number(plan.percentage))) / 100;
}

export const isExempt = (plan) => plan?.kind === 'percentage' && Number(plan.percentage) >= 100;
