import { useState } from 'react';
import Icon from '../../../components/ui/Icon';
import { ACCOUNTS_FOR_METHOD, ACCOUNT_METHODS, bankLabel, groupAccount } from '../banks';

/** Un dato con botón "Copiar" (para pegarlo en la app del banco). */
function CopyField({ label, value, display }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sin portapapeles (navegador antiguo / sin permiso): el dato queda visible para copiarlo a mano
    }
  };
  return (
    <div className="pay-info__row">
      <dt>{label}</dt>
      <dd>
        <span className="pay-info__value">{display || value}</span>
        <button type="button" className="pay-info__copy" onClick={copy} aria-label={`Copiar ${label.toLowerCase()}`} title="Copiar">
          <Icon name={copied ? 'check' : 'paperclip'} size={13} /> {copied ? 'Copiado' : 'Copiar'}
        </button>
      </dd>
    </div>
  );
}

/** Tarjeta de una cuenta: pago móvil (cédula/RIF, teléfono, banco) o transferencia (cuenta, tipo, banco, titular). */
export function PaymentAccountCard({ account, actions }) {
  const meta = ACCOUNT_METHODS[account.method];
  return (
    <article className={`pay-info__card ${account.is_active === false ? 'is-inactive' : ''}`}>
      <header className="pay-info__head">
        <span className="pay-info__icon">
          <Icon name={meta.icon} size={16} />
        </span>
        <div>
          <strong>{bankLabel(account)}</strong>
          <span className="pay-info__method">
            {meta.label}
            {account.account_type_label ? ` · Cuenta ${account.account_type_label.toLowerCase()}` : ''}
            {account.is_active === false ? ' · No visible para representantes' : ''}
          </span>
        </div>
        {actions && <div className="pay-info__actions">{actions}</div>}
      </header>
      <dl>
        {account.method === 'transfer' && (
          <CopyField label="Número de cuenta" value={account.account_number} display={groupAccount(account.account_number)} />
        )}
        {account.method === 'mobile_payment' && <CopyField label="Teléfono" value={account.phone} />}
        <CopyField label="Cédula / RIF" value={account.holder_id} />
        {account.bank_code && <CopyField label="Código del banco" value={account.bank_code} />}
        {account.holder_name && <CopyField label="Titular" value={account.holder_name} />}
      </dl>
      {account.notes && (
        <p className="pay-info__notes">
          <Icon name="info" size={13} /> {account.notes}
        </p>
      )}
    </article>
  );
}

/**
 * Datos de pago del colegio para el método elegido en el reporte:
 *   pago móvil → cuentas de pago móvil; transferencia o depósito → cuentas
 *   bancarias. Efectivo, tarjeta u otro: no muestra nada.
 * `accounts`: GET /portal/payment-accounts (solo las activas).
 */
function PaymentInstructions({ method, accounts, loading }) {
  const kind = ACCOUNTS_FOR_METHOD[method];
  if (!kind) return null;
  const list = (accounts || []).filter((a) => a.method === kind);
  const title = method === 'mobile_payment' ? 'Datos para el pago móvil' : method === 'deposit' ? 'Cuentas para el depósito' : 'Cuentas para la transferencia';

  return (
    <section className="pay-info" aria-live="polite">
      <div className="pay-info__title">
        <Icon name="wallet" size={16} /> {title}
      </div>
      {loading ? (
        <p className="text-sm text-muted">Cargando los datos de pago del colegio…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted">
          El colegio aún no registró sus datos de {method === 'mobile_payment' ? 'pago móvil' : 'cuenta bancaria'}: consúltalos con la administración.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted pay-info__lead">
            {list.length > 1 ? 'Puedes pagar a cualquiera de estas cuentas. ' : ''}Haz el pago y luego registra abajo la referencia del comprobante.
          </p>
          <div className="pay-info__list">
            {list.map((a) => (
              <PaymentAccountCard key={a.id} account={a} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default PaymentInstructions;
