import { useEffect, useMemo, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import portalApi from '../../../api/endpoints/portal.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import FileDropzone from '../../../components/ui/FileDropzone';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ConversionBreakdown, REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { CurrencySelect } from '../currency';
import { refTotal, totalsOf } from './StudentPaymentsSection';
import PaymentInstructions from './PaymentInstructions';
import { ProofViewerModal } from './ProofViewer';

const PROOF_ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] };
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** ¿La cuota se puede incluir en un pago agrupado? Exigible y aún sin reportar. */
export const isBatchable = (p) => ['overdue', 'pending'].includes(p.display_status);

export const BATCH_STATUS = {
  reported: { label: 'En revisión', variant: 'warning' },
  approved: { label: 'Aprobado', variant: 'success' },
  rejected: { label: 'Rechazado', variant: 'danger' },
  withdrawn: { label: 'Retirado', variant: 'neutral' },
};

// ---------------------------------------------------------------------------
// Barra de selección ("carrito")
// ---------------------------------------------------------------------------

/** Barra fija al pie: cuántas cuotas, de cuántos alumnos, total y "Pagar seleccionadas". */
export function BatchCartBar({ selected, onClear, onPay }) {
  if (!selected.length) return null;
  const students = new Set(selected.map((p) => p.student_id)).size;
  const ref = refTotal(selected);
  return (
    <div className="batch-cart" role="region" aria-label="Pago agrupado">
      <div className="batch-cart__info">
        <span className="batch-cart__count">{selected.length}</span>
        <div>
          <strong>
            {selected.length === 1 ? 'cuota seleccionada' : 'cuotas seleccionadas'}
            {students > 1 && ` · ${students} alumnos`}
          </strong>
          <div className="batch-cart__total">
            Total: <strong>{formatAmounts(totalsOf(selected))}</strong>
            {ref && ref.currency !== 'USD' && <span className="text-muted"> · ≈ {formatMoney(ref.amount, ref.currency)} a la tasa de hoy</span>}
          </div>
        </div>
      </div>
      <div className="batch-cart__actions">
        <Button variant="ghost" onClick={onClear}>
          Quitar selección
        </Button>
        <Button icon="wallet" onClick={onPay}>
          Pagar seleccionadas
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reportar el pago agrupado
// ---------------------------------------------------------------------------

/**
 * Un solo pago por varias cuotas: resumen por alumno, moneda y cotización del
 * total, datos del pago y UN comprobante. Administración lo aprueba completo.
 */
export function BatchPaymentDrawer({ payments, onClose, onDone }) {
  const toast = useToast();
  const todayStr = localToday();
  const [form, setForm] = useState({ method: 'transfer', reference: '', paidOn: todayStr, note: '' });
  const [proofFile, setProofFile] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [touched, setTouched] = useState({});
  const touch = (key) => () => setTouched((t) => ({ ...t, [key]: true }));
  const ids = useMemo(() => payments.map((p) => p.id), [payments]);

  // Obligatorios: método, fecha (no futura), referencia y comprobante. Solo la nota es opcional.
  const missing = {
    method: !form.method ? 'Elige el método de pago.' : null,
    paidOn: !form.paidOn ? 'Indica la fecha de pago.' : form.paidOn > todayStr ? 'La fecha de pago no puede ser futura.' : null,
    reference: !form.reference.trim() ? 'Indica el número de referencia de la operación.' : null,
    proof: !proofFile ? 'Adjunta el comprobante del pago total.' : null,
  };
  const incomplete = Object.values(missing).some(Boolean);
  const errorFor = (key) => fieldErrors[key] || (touched[key] ? missing[key] : null);
  const { data: rates } = useFetch(() => paymentsApi.currentRate(), []);
  const { data: accounts, loading: loadingAccounts } = useFetch(() => portalApi.getPaymentAccounts(), []);
  const currencies = [...new Set(payments.map((p) => p.currency))];
  const lockedTo = currencies.length === 1 && currencies[0] !== 'USD' ? currencies[0] : null;
  const [currency, setCurrency] = useState(null);
  const payCurrency = lockedTo || currency || rates?.default_currency || null;
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const { run, loading, error, fieldErrors } = useMutation((data) => paymentsApi.createBatch(data, proofFile));

  useEffect(() => {
    if (!payCurrency || !form.paidOn || currencies.length > 1) return undefined;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      paymentsApi
        .batchQuote({ paymentIds: ids, currency: payCurrency, date: form.paidOn })
        .then((q) => !cancelled && (setQuote(q), setQuoteError(null)))
        .catch((err) => !cancelled && (setQuote(null), setQuoteError(getErrorMessage(err))))
        .finally(() => !cancelled && setQuoting(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, payCurrency, form.paidOn]);

  // Agrupadas por alumno para el resumen.
  const byStudent = useMemo(() => {
    const map = new Map();
    payments.forEach((p) => {
      const key = p.student_id;
      if (!map.has(key)) map.set(key, { name: `${p.student_first_name} ${p.student_last_name}`, items: [] });
      map.get(key).items.push(p);
    });
    return [...map.values()];
  }, [payments]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (incomplete) {
      setTouched({ method: true, paidOn: true, reference: true, proof: true });
      return;
    }
    try {
      const batch = await run({
        paymentIds: ids,
        method: form.method,
        reference: form.reference.trim() || undefined,
        paidOn: form.paidOn,
        note: form.note.trim() || undefined,
        currency: payCurrency || undefined,
      });
      toast.success('Pago agrupado enviado', `${batch.item_count} cuotas por ${formatMoney(batch.base_total, batch.base_currency)}. Administración lo revisará y te enviará los recibos.`);
      onDone?.(batch);
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  return (
    <Drawer title="Pagar varias cuotas" onClose={onClose} size="lg">
      {currencies.length > 1 && (
        <Alert variant="warning">Las cuotas elegidas están en monedas distintas ({currencies.join(', ')}): págalas en pagos separados, una moneda por pago.</Alert>
      )}
      <div className="batch-summary">
        {byStudent.map((s) => (
          <section key={s.name} className="batch-summary__student">
            <h4>
              <Icon name="user" size={14} /> {s.name}
            </h4>
            <ul>
              {s.items.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.period_label}
                    <small className={p.display_status === 'overdue' ? 'text-danger' : 'text-muted'}>
                      {p.display_status === 'overdue' ? ' · vencida' : ''} · vence el {formatDate(p.due_date, false)}
                    </small>
                  </span>
                  <strong>{formatMoney(p.amount, p.currency)}</strong>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="batch-summary__total">
          <span>
            Total ({payments.length} cuota{payments.length === 1 ? '' : 's'})
          </span>
          <strong>{formatAmounts(totalsOf(payments))}</strong>
        </div>
      </div>

      <div className="pay-currency">
        <Field label="Moneda de pago" hint={lockedTo ? `Estas cuotas son en ${lockedTo}: se pagan en esa moneda.` : 'Las tarifas están en dólares; elige en qué moneda pagas el total.'}>
          <CurrencySelect value={payCurrency} onChange={setCurrency} status={rates} lockedTo={lockedTo} disabled={!rates || currencies.length > 1} />
        </Field>
      </div>
      <div className={`pay-quote ${quoting ? 'is-loading' : ''}`} aria-live="polite">
        {quote && <ConversionBreakdown quote={{ ...quote, base_amount: quote.base_total }} />}
      </div>
      {quoteError && <Alert variant="warning">{quoteError} Puedes reportar igual: administración aplicará la tasa al aprobar.</Alert>}

      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Método de pago" error={errorFor('method')} required>
            <Select value={form.method} onChange={set('method')}>
              {Object.entries(REPORT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de pago" error={errorFor('paidOn')} required>
            <Input type="date" value={form.paidOn} max={todayStr} onChange={set('paidOn')} onBlur={touch('paidOn')} required />
          </Field>
          <div className="form-field--full">
            <PaymentInstructions method={form.method} accounts={accounts} loading={loadingAccounts} />
          </div>
          <Field
            label="Número de referencia"
            error={errorFor('reference')}
            full
            required
            hint={form.method === 'cash' ? 'En efectivo: el número del recibo que te entregaron.' : 'Una sola operación por el total.'}
          >
            <Input value={form.reference} onChange={set('reference')} onBlur={touch('reference')} maxLength={60} required placeholder="Ej. 000123456789" />
          </Field>
          <Field label="Nota (opcional)" error={fieldErrors.note} full>
            <textarea className="input" rows={2} maxLength={300} value={form.note} onChange={set('note')} placeholder="Banco de origen, titular de la cuenta…" />
          </Field>
          <Field label="Comprobante del pago total" error={errorFor('proof')} full required>
            <FileDropzone
              value={proofFile}
              onChange={(file) => {
                setProofFile(file);
                setTouched((t) => ({ ...t, proof: true }));
              }}
              accept={PROOF_ACCEPT}
              maxBytes={PROOF_MAX_BYTES}
              label="Arrastra aquí el capture o PDF del pago"
              hint="Un solo archivo por el monto total · JPG, PNG o PDF · máximo 5 MB"
              disabled={loading}
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            icon="check"
            loading={loading}
            loadingText="Enviando…"
            disabled={incomplete || quoting || currencies.length > 1}
            title={incomplete ? 'Completa los campos obligatorios (*): fecha, referencia y comprobante.' : undefined}
          >
            Enviar pago de {payments.length} cuota{payments.length === 1 ? '' : 's'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Historial de pagos agrupados de la familia
// ---------------------------------------------------------------------------

/** Los pagos agrupados del representante: en revisión (con "Retirar"), aprobados y rechazados (con el motivo). */
export function MyBatches({ batches, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [viewing, setViewing] = useState(null);
  const recent = (batches || []).filter((b) => b.status !== 'withdrawn').slice(0, 6);
  if (!recent.length) return null;

  const withdraw = async (b) => {
    const ok = await confirm({
      title: '¿Retirar este pago agrupado?',
      message: `Sus ${b.item_count} cuotas vuelven a "por pagar" para que puedas corregir y reportar de nuevo.`,
      confirmLabel: 'Retirar',
      icon: 'refresh',
    });
    if (!ok) return;
    try {
      await paymentsApi.withdrawBatch(b.id);
      toast.success('Pago agrupado retirado', 'Las cuotas vuelven a estar por pagar.');
      onChanged?.();
    } catch (err) {
      toast.error('No se pudo retirar', getErrorMessage(err));
    }
  };

  return (
    <section className="card my-batches">
      <h3 className="card__title">
        <Icon name="layers" size={17} /> Pagos agrupados
      </h3>
      <ul>
        {recent.map((b) => (
          <li key={b.id} className={`my-batches__item my-batches__item--${b.status}`}>
            <div className="my-batches__main">
              <div className="my-batches__head">
                <strong>
                  {formatMoney(b.base_total, b.base_currency)}
                  {b.ref_total !== null && b.ref_currency !== b.base_currency && <span className="text-muted"> · {formatMoney(b.ref_total, b.ref_currency)}</span>}
                </strong>
                <Badge variant={BATCH_STATUS[b.status].variant}>{BATCH_STATUS[b.status].label}</Badge>
              </div>
              <div className="text-sm text-muted">
                {b.item_count} cuota{b.item_count === 1 ? '' : 's'}: {b.items.map((i) => `${i.period_label} (${i.student_name.split(' ')[0]})`).join(', ')}
              </div>
              <div className="text-sm text-muted">
                Reportado el {formatDate(b.reported_at)} · {REPORT_METHODS[b.method]}
                {b.reference ? ` · ref. ${b.reference}` : ''}
              </div>
              {b.status === 'rejected' && b.rejection_reason && (
                <div className="my-batches__reason">
                  <Icon name="alertCircle" size={14} /> {b.rejection_reason}
                </div>
              )}
            </div>
            <div className="my-batches__actions">
              {b.has_proof && (
                <Button size="sm" variant="ghost" icon="paperclip" onClick={() => setViewing(b)}>
                  Comprobante
                </Button>
              )}
              {b.status === 'reported' && (
                <Button size="sm" variant="secondary" onClick={() => withdraw(b)}>
                  Retirar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {viewing && (
        <ProofViewerModal
          payment={{ id: viewing.id, proof_mime: viewing.proof_mime, proof_original_name: viewing.proof_original_name, period_label: `Pago agrupado · ${viewing.item_count} cuotas`, proof_uploaded_at: viewing.proof_uploaded_at }}
          load={() => paymentsApi.getBatchProofBlob(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}
