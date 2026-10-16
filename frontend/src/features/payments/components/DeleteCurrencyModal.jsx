import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { PAYMENT_STATUS } from '../paymentStatus';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Advertencia antes de eliminar una moneda del colegio: muestra TODO lo que se
 * borrará con ella (tasas de cambio, pagos emitidos o registrados en esa
 * moneda, sus comprobantes y recibos) y, si hay registros, pide escribir el
 * código de la moneda para confirmar. Pensado para limpiar datos de prueba:
 * si la moneda tiene pagos reales, lo correcto es desactivarla.
 */
function DeleteCurrencyModal({ currency, onClose, onDeleted, onDeactivate }) {
  const toast = useToast();
  const { data: impact, loading, error } = useFetch(() => paymentsApi.currencyDeletionImpact(currency.code), [currency.code]);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const total = impact ? impact.rates + impact.payments.total : 0;
  const confirmed = !impact?.needs_confirmation || typed.trim().toUpperCase() === currency.code;

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await paymentsApi.removeCurrency(currency.code, impact.needs_confirmation ? typed.trim() : undefined);
      toast.success(
        `${currency.name} (${currency.code}) eliminada`,
        total ? `También se eliminaron ${plural(r.deleted_payments, 'pago', 'pagos')} y ${plural(r.deleted_rates, 'tasa', 'tasas')}.` : undefined
      );
      onDeleted();
      onClose();
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title={`Eliminar ${currency.name} (${currency.code})`} onClose={onClose}>
      <div className="delete-currency">
        <div className="delete-currency__icon">
          <Icon name="alertTriangle" size={26} />
        </div>
        <Alert>{error || deleteError}</Alert>
        {loading || !impact ? (
          !error && <Spinner label="Calculando qué se eliminará…" />
        ) : impact.blocked_reason ? (
          <Alert variant="warning">{impact.blocked_reason}</Alert>
        ) : (
          <>
            <p className="delete-currency__lead">
              {total ? (
                <>
                  Se eliminará <strong>{currency.name} ({currency.code})</strong> del colegio <strong>y todos sus registros asociados</strong>:
                </>
              ) : (
                <>
                  <strong>{currency.name} ({currency.code})</strong> no tiene tasas ni pagos registrados: solo se quitará del colegio.
                </>
              )}
            </p>
            {total > 0 && (
              <ul className="delete-currency__list">
                {impact.rates > 0 && (
                  <li>
                    <Icon name="trendingUp" size={15} /> <strong>{plural(impact.rates, 'tasa de cambio', 'tasas de cambio')}</strong> registradas
                  </li>
                )}
                {impact.payments.total > 0 && (
                  <li>
                    <Icon name="receipt" size={15} />
                    <span>
                      <strong>{plural(impact.payments.total, 'pago o cobro', 'pagos o cobros')}</strong>
                      {impact.payments.in_currency > 0 && impact.payments.paid_with_currency > 0
                        ? ` (${impact.payments.in_currency} emitidos en ${currency.code} y ${impact.payments.paid_with_currency} en dólares pagados o reportados en ${currency.code})`
                        : impact.payments.in_currency > 0
                          ? ` emitidos en ${currency.code}`
                          : ` en dólares pagados o reportados en ${currency.code}`}
                      <span className="delete-currency__statuses">
                        {Object.entries(impact.payments.by_status).map(([status, n]) => (
                          <span key={status} className="chip">
                            {n} {(PAYMENT_STATUS[status]?.label || status).toLowerCase()}
                          </span>
                        ))}
                      </span>
                    </span>
                  </li>
                )}
                {impact.payments.proofs + impact.payments.receipts > 0 && (
                  <li>
                    <Icon name="paperclip" size={15} />
                    {[impact.payments.proofs && plural(impact.payments.proofs, 'comprobante', 'comprobantes'), impact.payments.receipts && plural(impact.payments.receipts, 'recibo PDF', 'recibos PDF')]
                      .filter(Boolean)
                      .join(' y ')}{' '}
                    de esos pagos
                  </li>
                )}
              </ul>
            )}
            {total > 0 && (
              <Alert variant="warning">
                <strong>Esta acción no se puede deshacer.</strong> Úsala para limpiar monedas y pagos de prueba. Si hay pagos reales de familias,{' '}
                {currency.is_active && onDeactivate ? (
                  <button type="button" className="link-button" onClick={onDeactivate}>
                    desactiva la moneda
                  </button>
                ) : (
                  'desactiva la moneda'
                )}{' '}
                en su lugar: deja de ofrecerse y conserva el historial.
              </Alert>
            )}
            {impact.needs_confirmation && (
              <label className="delete-currency__confirm">
                <span>
                  Para confirmar, escribe <strong>{currency.code}</strong>:
                </span>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={3} autoFocus aria-label={`Escribe ${currency.code} para confirmar`} />
              </label>
            )}
          </>
        )}
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        {impact && !impact.blocked_reason && (
          <Button type="button" variant="danger-solid" icon="trash" onClick={remove} loading={deleting} loadingText="Eliminando…" disabled={!confirmed}>
            {total ? `Eliminar moneda y ${plural(total, 'registro', 'registros')}` : 'Eliminar moneda'}
          </Button>
        )}
      </div>
    </Modal>
  );
}

export default DeleteCurrencyModal;
