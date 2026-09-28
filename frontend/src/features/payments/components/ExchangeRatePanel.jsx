import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { formatDate, formatRate } from '../paymentStatus';

const SOURCE_LABELS = { bcv: 'Consultada al BCV', manual: 'Registrada manualmente' };

/**
 * Tasa BCV vigente para el panel de pagos del administrador: valor, fecha
 * valor, próxima tasa ya publicada y acciones (consultar BCV / registrar).
 * `onChanged` recarga la tabla de pagos (los montos en Bs dependen de la tasa).
 */
export function ExchangeRatePanel({ onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: status, loading, refetch } = useFetch(() => paymentsApi.currentRate(), []);
  const { data: history, refetch: refetchHistory } = useFetch(() => paymentsApi.listRates(), []);
  const [editing, setEditing] = useState(false);
  const [fetching, setFetching] = useState(false);
  const canEdit = can('payments', 'update');

  const reload = () => {
    refetch();
    refetchHistory();
    onChanged?.();
  };

  const handleFetchBcv = async () => {
    setFetching(true);
    try {
      const r = await paymentsApi.fetchBcvRate();
      const effectiveNow = r.fetched.rate_date <= r.today;
      toast.success(
        `Tasa BCV: Bs. ${formatRate(r.fetched.rate)}`,
        effectiveNow ? `Vigente desde ${formatDate(r.fetched.rate_date)}.` : `Fecha valor ${formatDate(r.fetched.rate_date)}: regirá desde ese día.`
      );
      reload();
    } catch (err) {
      toast.error('No se pudo consultar el BCV', getErrorMessage(err));
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async (rate) => {
    const ok = await confirm({
      title: `¿Eliminar la tasa del ${formatDate(rate.rate_date)}?`,
      message: 'Solo si fue un error de carga. Las cuotas pendientes se recalcularán con la tasa anterior.',
      danger: true,
    });
    if (!ok) return;
    try {
      await paymentsApi.deleteRate(rate.id);
      reload();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  const current = status?.current;

  return (
    <section className={`rate-panel ${!loading && status?.stale ? 'rate-panel--stale' : ''}`}>
      <div className="rate-panel__main">
        <span className="rate-panel__icon">
          <Icon name="trendingUp" size={22} />
        </span>
        <div>
          <div className="student-card__label">Tasa BCV vigente (Bs por USD)</div>
          {loading ? (
            <div className="stat-skeleton skeleton" />
          ) : current ? (
            <>
              <div className="rate-panel__value">Bs. {formatRate(current.rate)}</div>
              <div className="cell-person__sub">
                Fecha valor {formatDate(current.rate_date)} · {SOURCE_LABELS[current.source]}
              </div>
            </>
          ) : (
            <div className="rate-panel__value rate-panel__value--empty">Sin tasa registrada</div>
          )}
        </div>
      </div>

      <div className="rate-panel__side">
        {status?.next && (
          <div className="rate-panel__next">
            <Icon name="info" size={15} />
            Próxima: <strong>Bs. {formatRate(status.next.rate)}</strong> desde el {formatDate(status.next.rate_date)}
          </div>
        )}
        {!loading && status?.stale && (
          <div className="rate-panel__warning">
            <Icon name="alertTriangle" size={15} />
            {current
              ? `La tasa tiene ${status.age_days} días. Actualízala para cobrar con el valor oficial.`
              : 'Registra la tasa del día: sin ella no se pueden calcular los montos en Bs ni confirmar pagos en USD.'}
          </div>
        )}
        {canEdit && (
          <div className="rate-panel__actions">
            <Button size="sm" icon="sparkles" onClick={handleFetchBcv} loading={fetching} loadingText="Consultando…">
              Consultar BCV
            </Button>
            <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
              Registrar tasa
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <RateFormModal
          today={status?.today}
          history={history || []}
          onDelete={canEdit ? handleDelete : undefined}
          onClose={() => setEditing(false)}
          onSaved={reload}
        />
      )}
    </section>
  );
}

function RateFormModal({ today, history, onDelete, onClose, onSaved }) {
  const [form, setForm] = useState({ rateDate: today || '', rate: '' });
  const { run, loading, error, fieldErrors } = useMutation(paymentsApi.upsertRate);
  const toast = useToast();
  const rate = Number(String(form.rate).replace(',', '.'));
  const invalid = !(rate > 0) || !form.rateDate;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ rateDate: form.rateDate, rate });
      toast.success('Tasa registrada', `Bs. ${formatRate(rate)} · fecha valor ${formatDate(form.rateDate)}`);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Registrar tasa BCV" onClose={onClose}>
      <p style={{ marginTop: -6 }} className="text-sm">
        Usa la tasa oficial publicada por el BCV y su <strong>fecha valor</strong> (el día desde el que rige). Si ya existe una
        tasa para esa fecha, se corrige.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Fecha valor" error={fieldErrors.rateDate} required>
            <Input type="date" value={form.rateDate} onChange={(e) => setForm((f) => ({ ...f, rateDate: e.target.value }))} required />
          </Field>
          <Field label="Bs por 1 USD" error={fieldErrors.rate} hint="Ej.: 857,0058" required>
            <Input
              inputMode="decimal"
              value={form.rate}
              onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
              placeholder="0,0000"
              suffix="Bs"
              required
            />
          </Field>
        </div>
        {rate > 0 && (
          <p className="form-hint" style={{ marginTop: 10 }}>
            Ejemplo: una cuota de $120,00 equivaldría a <strong>Bs. {(Math.round(120 * rate * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</strong>.
          </p>
        )}

        {history.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section__title">Historial reciente</h4>
            <ul className="rate-history">
              {history.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <span>{formatDate(r.rate_date)}</span>
                  <strong>Bs. {formatRate(r.rate)}</strong>
                  <span className="text-muted">{r.source === 'bcv' ? 'BCV' : r.created_by_name || 'Manual'}</span>
                  {onDelete && (
                    <button type="button" className="row-action row-action--delete" onClick={() => onDelete(r)} aria-label="Eliminar tasa" title="Eliminar tasa">
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={invalid}>
            Guardar tasa
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Aviso compacto de la tasa vigente para el portal del representante. */
export function RateBanner({ exchange }) {
  if (!exchange) return null;
  return (
    <div className={`rate-banner ${exchange.current ? '' : 'rate-banner--missing'}`}>
      <Icon name="trendingUp" size={17} />
      {exchange.current ? (
        <span>
          Tasa BCV del día: <strong>Bs. {formatRate(exchange.current.rate)}</strong> por dólar (fecha valor{' '}
          {formatDate(exchange.current.rate_date)}). Los montos en Bs se calculan con esta tasa.
        </span>
      ) : (
        <span>El colegio aún no ha registrado la tasa BCV del día: por ahora solo se muestran los montos en dólares.</span>
      )}
    </div>
  );
}
