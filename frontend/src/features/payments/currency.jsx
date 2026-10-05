import Select from '../../components/ui/Select';
import Icon from '../../components/ui/Icon';

/**
 * Monedas: formato, selector y desglose de conversión (migración 010).
 *
 * La tarifa base es siempre en USD; cada pago se expresa además en una moneda
 * de referencia (VES, COP, PEN…) con la tasa del día de esa moneda. TODOS los
 * montos convertidos los calcula el backend (NUMERIC exacto): aquí solo se
 * formatean. Este catálogo es un espejo del de la base, usado para formatear
 * sin esperar a la API; los datos del colegio que manda la API (nombre,
 * símbolo y decimales personalizados, migración 011) tienen prioridad: se
 * registran con `registerCurrencies` cada vez que llegan.
 */
export const CURRENCY_META = {
  USD: { name: 'Dólar estadounidense', symbol: '$', decimals: 2, locale: 'es-VE' },
  VES: { name: 'Bolívar', symbol: 'Bs.', decimals: 2, locale: 'es-VE' },
  COP: { name: 'Peso colombiano', symbol: 'COL$', decimals: 2, locale: 'es-CO' },
  PEN: { name: 'Sol', symbol: 'S/', decimals: 2, locale: 'es-PE' },
  ARS: { name: 'Peso argentino', symbol: 'AR$', decimals: 2, locale: 'es-AR' },
  CLP: { name: 'Peso chileno', symbol: 'CLP$', decimals: 0, locale: 'es-CL' },
  MXN: { name: 'Peso mexicano', symbol: 'MX$', decimals: 2, locale: 'es-MX' },
  BRL: { name: 'Real', symbol: 'R$', decimals: 2, locale: 'pt-BR' },
  BOB: { name: 'Boliviano', symbol: 'Bs', decimals: 2, locale: 'es-BO' },
  UYU: { name: 'Peso uruguayo', symbol: '$U', decimals: 2, locale: 'es-UY' },
  PYG: { name: 'Guaraní', symbol: '₲', decimals: 0, locale: 'es-PY' },
  DOP: { name: 'Peso dominicano', symbol: 'RD$', decimals: 2, locale: 'es-DO' },
  CRC: { name: 'Colón', symbol: '₡', decimals: 2, locale: 'es-CR' },
  GTQ: { name: 'Quetzal', symbol: 'Q', decimals: 2, locale: 'es-GT' },
  HNL: { name: 'Lempira', symbol: 'L', decimals: 2, locale: 'es-HN' },
  NIO: { name: 'Córdoba', symbol: 'C$', decimals: 2, locale: 'es-NI' },
  PAB: { name: 'Balboa', symbol: 'B/.', decimals: 2, locale: 'es-PA' },
  CUP: { name: 'Peso cubano', symbol: 'CUP$', decimals: 2, locale: 'es-CU' },
  HTG: { name: 'Gourde', symbol: 'G', decimals: 2, locale: 'fr-HT' },
  EUR: { name: 'Euro', symbol: '€', decimals: 2, locale: 'es-ES' },
};

/** Datos del colegio (personalizados) por código; tienen prioridad sobre CURRENCY_META. */
const registry = new Map();

/** Registra las monedas que devuelve la API ({ code, name, symbol, decimals, locale }). */
export function registerCurrencies(list = []) {
  list.forEach((c) => {
    if (!c?.code) return;
    const base = CURRENCY_META[c.code] || {};
    registry.set(c.code, {
      name: c.name ?? base.name,
      symbol: c.symbol ?? base.symbol,
      decimals: c.decimals ?? base.decimals ?? 2,
      locale: c.locale ?? base.locale ?? 'es',
    });
  });
}

export const BASE_CURRENCY = 'USD';

export const currencyMeta = (code) => registry.get(code) || CURRENCY_META[code] || { name: code, symbol: code, decimals: 2, locale: 'es' };

/** "Peso colombiano (COP)". */
export const currencyLabel = (code) => `${currencyMeta(code).name} (${code})`;

const number = (value, locale, min, max) =>
  Number(value).toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });

/**
 * "$120,00", "Bs. 96.060,00", "COL$ 494.820,00", "S/ 450.00", "CLP$ 27.854".
 * Cada moneda con los decimales y separadores de su país.
 */
export function formatMoney(amount, currency = BASE_CURRENCY) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const meta = currencyMeta(currency);
  const text = number(amount, meta.locale, meta.decimals, meta.decimals);
  return currency === BASE_CURRENCY ? `$${text}` : `${meta.symbol} ${text}`;
}

/** Tasa (moneda local por 1 USD) con 2 a 4 decimales: "Bs. 800,5000" → "Bs. 800,50". */
export function formatRate(rate, currency) {
  if (rate === null || rate === undefined) return '—';
  const meta = currency ? currencyMeta(currency) : CURRENCY_META.VES;
  const text = number(rate, meta.locale, 2, 4);
  return currency ? `${meta.symbol} ${text}` : text;
}

/**
 * Selector de moneda de referencia: el USD (siempre) + las monedas activas del
 * colegio (`status.currencies`, de GET /payments/exchange-rates/current).
 * Cada opción avisa si la moneda aún no tiene tasa registrada.
 */
export function CurrencySelect({ value, onChange, status, includeUsd = true, disabled, lockedTo, ...props }) {
  const enabled = status?.currencies || [];
  const options = [
    ...enabled.map((c) => ({ code: c.code, missing: !c.current, isDefault: c.is_default })),
    ...(includeUsd ? [{ code: BASE_CURRENCY, missing: false }] : []),
  ];
  // Un cobro en moneda local solo se paga en esa moneda.
  if (lockedTo && !options.some((o) => o.code === lockedTo)) options.unshift({ code: lockedTo, missing: false });

  return (
    <Select value={lockedTo || value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled || Boolean(lockedTo)} {...props}>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {currencyLabel(o.code)}
          {o.code === BASE_CURRENCY ? ' · sin conversión' : o.missing ? ' · sin tasa registrada' : o.isDefault ? ' · predeterminada' : ''}
        </option>
      ))}
    </Select>
  );
}

/** Normaliza un pago (columnas conv_* del backend) o una cotización (GET /payments/:id/quote). */
function conversionOf({ payment, quote }) {
  if (quote) {
    return {
      baseAmount: quote.base_amount,
      baseCurrency: quote.base_currency,
      currency: quote.currency.code,
      rate: quote.rate,
      rateDate: quote.rate_date,
      amount: quote.amount,
      estimated: quote.estimated,
    };
  }
  return {
    baseAmount: payment.amount,
    baseCurrency: payment.currency,
    currency: payment.conv_currency || payment.currency,
    rate: payment.conv_rate,
    rateDate: payment.conv_rate_date,
    amount: payment.conv_amount,
    estimated: payment.conv_estimated,
  };
}

const shortDate = (value) => {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

/**
 * Desglose de un cobro: monto base en USD → moneda de referencia y su tasa
 * del día → total en esa moneda.
 * - Pendiente: estimado con la tasa vigente (cambia si cambia la tasa).
 * - Pagado: la conversión guardada al confirmar (tasa de la fecha de pago).
 * `compact` = una sola línea para tablas.
 */
export function ConversionBreakdown({ payment, quote, compact = false }) {
  const c = conversionOf({ payment, quote });
  const converted = c.currency !== c.baseCurrency;
  const hasAmount = c.amount !== null && c.amount !== undefined;

  if (compact) {
    if (!converted) return null;
    return hasAmount ? (
      <span className="cell-person__sub" title={`${currencyLabel(c.currency)} · tasa ${formatRate(c.rate, c.currency)} (fecha valor ${shortDate(c.rateDate)})`}>
        {c.estimated ? '≈ ' : ''}
        {formatMoney(c.amount, c.currency)}
      </span>
    ) : (
      <span className="cell-person__sub text-warning">Sin tasa {c.currency}</span>
    );
  }

  if (!converted) {
    return (
      <div className="bs-breakdown bs-breakdown--single">
        {c.baseCurrency === BASE_CURRENCY ? 'Pago en dólares: sin conversión' : `Cobro en ${currencyLabel(c.baseCurrency)}`}
      </div>
    );
  }

  const meta = currencyMeta(c.currency);
  return (
    <dl className="bs-breakdown">
      <div>
        <dt>Monto base en divisa</dt>
        <dd>{formatMoney(c.baseAmount, c.baseCurrency)}</dd>
      </div>
      <div>
        <dt>Moneda de referencia</dt>
        <dd>{currencyLabel(c.currency)}</dd>
      </div>
      <div>
        <dt>Tasa {c.estimated ? 'del día' : 'aplicada'}</dt>
        <dd>
          {hasAmount ? (
            <>
              {formatRate(c.rate, c.currency)} <small>/ $ · f. valor {shortDate(c.rateDate)}</small>
            </>
          ) : (
            <span className="text-warning">
              <Icon name="alertTriangle" size={13} /> No registrada
            </span>
          )}
        </dd>
      </div>
      <div className="bs-breakdown__total">
        <dt>{c.estimated ? `Total a pagar en ${c.currency}` : `Pagado en ${c.currency}`}</dt>
        <dd title={meta.name}>{hasAmount ? formatMoney(c.amount, c.currency) : '—'}</dd>
      </div>
    </dl>
  );
}

/** Selector compacto "Ver montos en …" para encabezados de página. */
export function ViewCurrencySelect({ value, onChange, status }) {
  if (!status?.currencies?.length) return null;
  return (
    <label className="view-currency">
      <Icon name="wallet" size={15} />
      <span>Ver montos en</span>
      <CurrencySelect value={value} onChange={onChange} status={status} aria-label="Moneda de referencia para mostrar los montos" />
    </label>
  );
}
