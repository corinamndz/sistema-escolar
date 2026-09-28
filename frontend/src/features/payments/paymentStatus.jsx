import Badge from '../../components/ui/Badge';
import Icon from '../../components/ui/Icon';

/**
 * Presentación de los estados de pago. El estado lo calcula el backend con la
 * fecha de hoy (`display_status`); aquí solo hay textos y colores.
 */
export const PAYMENT_STATUS = {
  pending: { label: 'Pendiente', variant: 'warning' },
  overdue: { label: 'Vencido', variant: 'danger' },
  reported: { label: 'Reportado', variant: 'info' },
  scheduled: { label: 'Programado', variant: 'neutral' },
  paid: { label: 'Pagado', variant: 'success' },
  failed: { label: 'Fallido', variant: 'danger' },
  refunded: { label: 'Reembolsado', variant: 'neutral' },
  cancelled: { label: 'Anulado', variant: 'neutral' },
};

export const REPORT_METHODS = {
  transfer: 'Transferencia',
  mobile_payment: 'Pago móvil',
  deposit: 'Depósito',
  cash: 'Efectivo',
  card: 'Tarjeta',
  other: 'Otro',
};

export function PaymentStatusBadge({ payment }) {
  const meta = PAYMENT_STATUS[payment.display_status] || PAYMENT_STATUS[payment.status] || { label: '—', variant: 'neutral' };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Número con formato venezolano: 96060 → "96.060,00". */
const veNumber = (value, digits = 2) =>
  Number(value).toLocaleString('es-VE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Convención venezolana: "$120,00" y "Bs. 96.060,00". Otras monedas con Intl. */
export function formatMoney(amount, currency = 'USD') {
  const value = Number(amount);
  if (currency === 'USD') return `$${veNumber(value)}`;
  if (currency === 'VES') return `Bs. ${veNumber(value)}`;
  try {
    return new Intl.NumberFormat('es', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Tasa BCV con 4 decimales: 857.0058 → "857,0058". */
export const formatRate = (rate) => (rate === null || rate === undefined ? '—' : veNumber(rate, 4));

/**
 * Desglose de una cuota en USD: monto base × tasa BCV = total en Bs.
 * - Pendiente: estimado con la tasa vigente hoy (cambia si cambia la tasa).
 * - Pagado: la conversión guardada al confirmar (tasa de la fecha de pago).
 * `compact` = una sola línea para tablas.
 */
export function BsBreakdown({ payment, compact = false }) {
  if (payment.currency === 'VES') {
    return compact ? null : <div className="bs-breakdown bs-breakdown--single">Cobro en bolívares</div>;
  }
  const hasRate = payment.ves_amount !== null && payment.ves_amount !== undefined;
  const label = payment.ves_estimated ? 'Total a pagar en Bs' : 'Pagado en Bs';

  if (compact) {
    return hasRate ? (
      <span className="cell-person__sub" title={`Tasa BCV ${formatRate(payment.ves_rate)} (fecha valor ${formatDate(payment.ves_rate_date)})`}>
        {payment.ves_estimated ? '≈ ' : ''}
        {formatMoney(payment.ves_amount, 'VES')}
      </span>
    ) : (
      <span className="cell-person__sub text-warning">Sin tasa BCV</span>
    );
  }

  return (
    <dl className="bs-breakdown">
      <div>
        <dt>Monto base en divisa</dt>
        <dd>{formatMoney(payment.amount, 'USD')}</dd>
      </div>
      <div>
        <dt>Tasa BCV {payment.ves_estimated ? 'del día' : 'aplicada'}</dt>
        <dd>
          {hasRate ? (
            <>
              Bs. {formatRate(payment.ves_rate)} <small>/ $ · f. valor {formatDate(payment.ves_rate_date, false)}</small>
            </>
          ) : (
            <span className="text-warning">No registrada</span>
          )}
        </dd>
      </div>
      <div className="bs-breakdown__total">
        <dt>{label}</dt>
        <dd>{hasRate ? formatMoney(payment.ves_amount, 'VES') : '—'}</dd>
      </div>
    </dl>
  );
}

/** "80,00 US$ + 1.500,00 VES": nunca se suman monedas distintas. */
export const formatAmounts = (amounts = []) => amounts.map((a) => formatMoney(a.total, a.currency)).join(' + ');

/**
 * → "5 oct 2026".
 * - Fecha de calendario 'YYYY-MM-DD' (vencimientos): se arma en hora local, sin
 *   pasar por UTC, para que no se corra un día.
 * - Marca de tiempo ISO (paid_at, reported_at): se convierte a la hora local del
 *   navegador (un pago a las 21:00 en Caracas ya es "mañana" en UTC).
 */
export function formatDate(value, withYear = true) {
  if (!value) return '—';
  const opts = { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) };
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es', opts);
  }
  return new Date(text).toLocaleDateString('es', opts);
}

/**
 * Fecha límite con contexto: "Vence hoy", "Vence en 3 días",
 * "Vencido hace 12 días". `days_overdue` viene del backend (hoy − vencimiento).
 */
export function DueDate({ payment }) {
  if (!payment.due_date) return <span className="text-muted">Sin fecha límite</span>;
  const days = payment.days_overdue;
  let hint = null;
  let tone = '';
  if (payment.status === 'pending' && days !== null && days !== undefined) {
    if (days > 0) {
      hint = `Vencido hace ${days} día${days === 1 ? '' : 's'}`;
      tone = 'due-date--overdue';
    } else if (days === 0) {
      hint = 'Vence hoy';
      tone = 'due-date--today';
    } else if (days >= -5 && payment.display_status !== 'scheduled') {
      hint = `Vence en ${-days} día${days === -1 ? '' : 's'}`;
      tone = 'due-date--soon';
    }
  }
  return (
    <div className={`due-date ${tone}`}>
      <span className="due-date__date">
        <Icon name="clipboard" size={13} /> {formatDate(payment.due_date)}
      </span>
      {hint && <span className="due-date__hint">{hint}</span>}
    </div>
  );
}
