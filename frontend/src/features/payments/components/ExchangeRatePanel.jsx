import { useState } from 'react';
import { Link } from 'react-router-dom';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { formatDate } from '../paymentStatus';
import { currencyLabel, currencyMeta, formatMoney, formatRate } from '../currency';

const SOURCE_LABELS = { bcv: 'Consultada al BCV', manual: 'Registrada manualmente' };

/**
 * Monedas de referencia del colegio y su tasa del día (moneda local por 1 USD):
 * una tarjeta por moneda activa con su valor, fecha valor, próxima tasa ya
 * publicada y aviso si está desactualizada. Acciones: registrar tasa,
 * consultar el BCV (solo bolívar) e ir a la administración de monedas
 * (/payments/currencies: agregar, editar, activar/desactivar, predeterminada).
 * `status` viene de GET /payments/exchange-rates/current; `onChanged` recarga
 * la página (los equivalentes dependen de las tasas).
 */
export function ExchangeRatePanel({ status, loading, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(null); // código de moneda o '' = la predeterminada
  const [fetching, setFetching] = useState(false);
  const canEdit = can('payments', 'update');
  const currencies = status?.currencies || [];
  const hasVes = currencies.some((c) => c.code === 'VES');

  const handleFetchBcv = async () => {
    setFetching(true);
    try {
      const r = await paymentsApi.fetchBcvRate();
      const effectiveNow = r.fetched.rate_date <= r.today;
      toast.success(
        `Tasa BCV: ${formatRate(r.fetched.rate, 'VES')}`,
        effectiveNow ? `Vigente desde ${formatDate(r.fetched.rate_date)}.` : `Fecha valor ${formatDate(r.fetched.rate_date)}: regirá desde ese día.`
      );
      onChanged?.();
    } catch (err) {
      toast.error('No se pudo consultar el BCV', getErrorMessage(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <section className="rate-board">
      <div className="rate-board__head">
        <div>
          <h3 className="card__title">Monedas y tasas del día</h3>
          <p className="card__subtitle">Las tarifas se fijan en dólares; cada familia paga en la moneda que elija con la tasa de ese día.</p>
        </div>
        {canEdit && (
          <div className="rate-board__actions">
            {hasVes && (
              <Button size="sm" variant="ghost" icon="sparkles" onClick={handleFetchBcv} loading={fetching} loadingText="Consultando…">
                Consultar BCV
              </Button>
            )}
            <Link to="/payments/currencies" className="btn btn--secondary btn--sm">
              <Icon name="settings" size={15} /> Administrar monedas
            </Link>
            <Button size="sm" icon="pencil" onClick={() => setEditing('')}>
              Registrar tasa
            </Button>
          </div>
        )}
      </div>

      {!loading && currencies.length === 1 && canEdit && (
        <Alert variant="info">
          Solo está activa {currencies[0].name} ({currencies[0].code}). Para cobrar en pesos, soles u otras monedas, actívalas en{' '}
          <Link to="/payments/currencies">Administrar monedas</Link>.
        </Alert>
      )}
      {loading && !status ? (
        <Spinner />
      ) : (
        <div className="rate-grid">
          {currencies.map((c) => (
            <article key={c.code} className={`rate-card ${c.stale ? 'rate-card--stale' : ''}`}>
              <div className="rate-card__head">
                <span className="chip">{c.code}</span>
                <span className="rate-card__name">{c.name}</span>
                {c.is_default && <span className="badge badge--primary">Predeterminada</span>}
              </div>
              {c.current ? (
                <>
                  <div className="rate-card__value">
                    {formatRate(c.current.rate, c.code)} <small>por $1</small>
                  </div>
                  <div className="cell-person__sub">
                    Fecha valor {formatDate(c.current.rate_date)} · {SOURCE_LABELS[c.current.source]}
                  </div>
                </>
              ) : (
                <div className="rate-card__value rate-panel__value--empty">Sin tasa registrada</div>
              )}
              {c.next && (
                <div className="rate-card__note">
                  <Icon name="info" size={14} /> Próxima: {formatRate(c.next.rate, c.code)} desde el {formatDate(c.next.rate_date)}
                </div>
              )}
              {c.stale && (
                <div className="rate-card__note rate-card__note--warning">
                  <Icon name="alertTriangle" size={14} />
                  {c.current ? `Tiene ${c.age_days} días: actualízala.` : 'Regístrala para cobrar en esta moneda.'}
                </div>
              )}
              {canEdit && (
                <button type="button" className="rate-card__edit" onClick={() => setEditing(c.code)}>
                  <Icon name="pencil" size={13} /> Actualizar
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {editing !== null && (
        <RateFormModal
          status={status}
          initialCurrency={editing || status?.default_currency}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}

function RateFormModal({ status, initialCurrency, onClose, onSaved }) {
  const [currency, setCurrency] = useState(initialCurrency);
  const [form, setForm] = useState({ rateDate: status?.today || '', rate: '' });
  const { data: history, refetch: refetchHistory } = useFetch(() => paymentsApi.listRates(currency), [currency]);
  const { run, loading, error, fieldErrors } = useMutation(paymentsApi.upsertRate);
  const toast = useToast();
  const confirm = useConfirm();
  const meta = currencyMeta(currency);
  const rate = Number(String(form.rate).replace(',', '.'));
  const invalid = !(rate > 0) || !form.rateDate;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ currency, rateDate: form.rateDate, rate });
      toast.success('Tasa registrada', `${currencyLabel(currency)}: ${formatRate(rate, currency)} · fecha valor ${formatDate(form.rateDate)}`);
      onSaved?.();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  const handleDelete = async (r) => {
    const ok = await confirm({
      title: `¿Eliminar la tasa del ${formatDate(r.rate_date)}?`,
      message: 'Solo si fue un error de carga. Las cuotas pendientes se recalcularán con la tasa anterior.',
      danger: true,
    });
    if (!ok) return;
    try {
      await paymentsApi.deleteRate(r.id);
      refetchHistory();
      onSaved?.();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <Modal title="Registrar tasa del día" onClose={onClose}>
      <p style={{ marginTop: -6 }} className="text-sm">
        Indica cuántas unidades de la moneda equivalen a <strong>1 dólar</strong> y su <strong>fecha valor</strong> (el día desde el que
        rige). Si ya existe una tasa para esa fecha, se corrige.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Moneda" error={fieldErrors.currency} full required>
            <Select sorted value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {(status?.currencies || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {currencyLabel(c.code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha valor" error={fieldErrors.rateDate} required>
            <Input type="date" value={form.rateDate} onChange={(e) => setForm((f) => ({ ...f, rateDate: e.target.value }))} required />
          </Field>
          <Field label={`${meta.symbol} por 1 USD`} error={fieldErrors.rate} hint={currency === 'VES' ? 'Tasa oficial BCV. Ej.: 857,0058' : 'Ej.: 4123,50'} required>
            <Input
              inputMode="decimal"
              value={form.rate}
              onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
              placeholder="0,0000"
              suffix={currency}
              required
            />
          </Field>
        </div>
        {rate > 0 && (
          <p className="form-hint" style={{ marginTop: 10 }}>
            {/* Solo ilustrativo: los montos reales los calcula el servidor con precisión decimal. */}
            Ejemplo: una cuota de $120,00 equivaldría a <strong>≈ {formatMoney(Math.round(120 * rate * 100) / 100, currency)}</strong>.
          </p>
        )}

        {history?.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section__title">Historial reciente · {currency}</h4>
            <ul className="rate-history">
              {history.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <span>{formatDate(r.rate_date)}</span>
                  <strong>{formatRate(r.rate, currency)}</strong>
                  <span className="text-muted">{r.source === 'bcv' ? 'BCV' : r.created_by_name || 'Manual'}</span>
                  <button type="button" className="row-action row-action--delete" onClick={() => handleDelete(r)} aria-label="Eliminar tasa" title="Eliminar tasa">
                    <Icon name="trash" size={14} />
                  </button>
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

/** Aviso compacto de las tasas del día para el portal del representante. */
export function RateBanner({ exchange }) {
  if (!exchange?.currencies?.length) return null;
  const withRate = exchange.currencies.filter((c) => c.current);
  return (
    <div className={`rate-banner ${withRate.length ? '' : 'rate-banner--missing'}`}>
      <Icon name="trendingUp" size={17} />
      {withRate.length ? (
        <span>
          Tasas del día por dólar:{' '}
          {withRate.map((c, i) => (
            <span key={c.code}>
              {i > 0 && ' · '}
              <strong>{formatRate(c.current.rate, c.code)}</strong> <span className="text-muted">({c.code})</span>
            </span>
          ))}
          . Elige en qué moneda ver y pagar tus cuotas.
        </span>
      ) : (
        <span>El colegio aún no ha registrado las tasas del día: por ahora solo se muestran los montos en dólares.</span>
      )}
    </div>
  );
}
