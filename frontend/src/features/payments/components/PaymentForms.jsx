import { useEffect, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useMutation } from '../../../hooks/useMutation';
import { useFetch } from '../../../hooks/useFetch';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { ConversionBreakdown, REPORT_METHODS, formatDate, formatMoney } from '../paymentStatus';
import { BASE_CURRENCY, CurrencySelect, currencyLabel } from '../currency';
import FileDropzone from '../../../components/ui/FileDropzone';
import { ProofButton } from './ProofViewer';

// Formatos de comprobante permitidos (el backend valida además la firma binaria real).
const PROOF_ACCEPT = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] };
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MODES = {
  // Representante: informa el pago; queda "reportado" hasta que administración lo confirme.
  report: {
    title: 'Reportar pago',
    submit: 'Enviar reporte',
    loading: 'Enviando…',
    call: (payment, data, file) => paymentsApi.report(payment.id, data, file),
    success: (toast) => toast.success('Pago reportado', 'Administración lo revisará y te enviará el comprobante.'),
  },
  // Administración: registra el pago recibido (genera comprobante y fija la tasa de la moneda elegida en la fecha de pago).
  register: {
    title: 'Registrar pago',
    submit: 'Registrar pago',
    loading: 'Registrando…',
    call: (payment, data, file) => paymentsApi.markAsPaid(payment.id, data, file),
    success: (toast, result) =>
      result?.emailSent
        ? toast.success('Pago registrado', 'Comprobante generado y enviado por correo al representante.')
        : toast.warning(
            'Pago registrado',
            `Comprobante generado, pero no se envió por correo${result?.emailError ? `: ${result.emailError}` : ' (el representante no tiene correo).'}`
          ),
  },
};

/**
 * Formulario de datos del pago de una cuota (método, referencia, fecha, nota).
 * `mode`: 'report' (representante) | 'register' (administración).
 *
 * "Moneda de pago": USD o una moneda activa del colegio. Al cambiarla (o la
 * fecha), se pide al servidor la cotización exacta con la tasa de esa moneda
 * vigente ese día y se muestra el desglose monto USD → tasa → total.
 */
export function PaymentFormModal({ payment, mode = 'report', onClose, onDone }) {
  const config = MODES[mode];
  const todayStr = localToday();
  const [form, setForm] = useState({
    method: payment.report_method || 'transfer',
    reference: payment.report_reference || '',
    paidOn: payment.report_paid_on || todayStr,
    note: payment.report_note || '',
  });
  const [proofFile, setProofFile] = useState(null);
  const { run, loading, error, fieldErrors } = useMutation((data) => config.call(payment, data, proofFile));
  const toast = useToast();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const needsReference = form.method !== 'cash';

  // ---- Moneda de pago y cotización ----
  const { data: rates } = useFetch(() => paymentsApi.currentRate(), []);
  // Un cobro que no es en USD (ej. un cargo en Bs) se paga en su propia moneda.
  const lockedTo = payment.currency !== BASE_CURRENCY ? payment.currency : null;
  const [currency, setCurrency] = useState(payment.ref_currency || null);
  const payCurrency = lockedTo || currency || rates?.default_currency || null;
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    if (!payCurrency || !form.paidOn) return undefined;
    let cancelled = false;
    setQuoting(true);
    // Pequeña espera: al escribir la fecha no se pide una cotización por tecla.
    const timer = setTimeout(() => {
      paymentsApi
        .quote(payment.id, { currency: payCurrency, date: form.paidOn })
        .then((q) => {
          if (cancelled) return;
          setQuote(q);
          setQuoteError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(getErrorMessage(err));
        })
        .finally(() => !cancelled && setQuoting(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payment.id, payCurrency, form.paidOn]);

  // Registrar exige la tasa (el monto queda congelado); reportar no: se aplica al confirmar.
  const blockedByRate = mode === 'register' && Boolean(quoteError);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await run({
        method: form.method,
        reference: form.reference.trim() || undefined,
        paidOn: form.paidOn,
        note: form.note.trim() || undefined,
        currency: payCurrency || undefined,
      });
      config.success(toast, result);
      onDone?.(result);
      onClose();
    } catch {
      // error visible en el modal (ej. falta la tasa de esa moneda en esa fecha)
    }
  };

  return (
    <Modal title={config.title} onClose={onClose}>
      <div className="pay-summary">
        <div>
          <div className="pay-card__concept">{payment.period_label}</div>
          <div className="cell-person__sub">
            {payment.student_first_name} {payment.student_last_name}
            {payment.due_date && ` · vence el ${formatDate(payment.due_date)}`}
          </div>
        </div>
        <div className="pay-card__amount">{formatMoney(payment.amount, payment.currency)}</div>
      </div>
      <div className="pay-currency">
        <Field
          label="Moneda de pago"
          hint={lockedTo ? `Este cobro es en ${currencyLabel(lockedTo)}: se paga en esa moneda.` : 'La tarifa base está en dólares; elige en qué moneda pagas.'}
        >
          <CurrencySelect value={payCurrency} onChange={setCurrency} status={rates} lockedTo={lockedTo} disabled={!rates} />
        </Field>
      </div>
      <div className={`pay-quote ${quoting ? 'is-loading' : ''}`} aria-live="polite">
        {quote ? <ConversionBreakdown quote={quote} /> : !quoteError && <ConversionBreakdown payment={payment} />}
      </div>
      {quoteError ? (
        <Alert variant="warning">
          {quoteError}
          {mode === 'report' && ' Puedes reportar igual: administración aplicará la tasa al confirmar.'}
        </Alert>
      ) : (
        payCurrency !== payment.currency && (
          <p className="form-hint" style={{ margin: '8px 0 14px' }}>
            {mode === 'register'
              ? `Al registrarlo, el monto en ${payCurrency} queda fijado con la tasa vigente en la fecha de pago indicada.`
              : `El monto en ${payCurrency} se calcula con la tasa vigente el día en que pagas. Si pagaste otro día, indica esa fecha.`}
          </p>
        )
      )}
      {mode === 'register' && payment.reported_at && (
        <Alert variant="info">
          El representante lo reportó el {formatDate(payment.reported_at)}
          {payment.proof_path ? ' y adjuntó un comprobante' : ' (sin comprobante adjunto)'}. Verifica los datos antes de registrarlo.
          {payment.proof_path && (
            <div style={{ marginTop: 8 }}>
              <ProofButton payment={payment} label="Ver comprobante del representante" />
            </div>
          )}
        </Alert>
      )}
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Método de pago" error={fieldErrors.method} required>
            <Select value={form.method} onChange={set('method')}>
              {Object.entries(REPORT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de pago" error={fieldErrors.paidOn} required>
            <Input type="date" value={form.paidOn} max={todayStr} onChange={set('paidOn')} required />
          </Field>
          <Field label="Número de referencia" error={fieldErrors.reference} full required={needsReference} hint="Aparece en el comprobante del banco.">
            <Input value={form.reference} onChange={set('reference')} maxLength={60} required={needsReference} placeholder="Ej. 000123456789" />
          </Field>
          <Field label="Nota (opcional)" error={fieldErrors.note} full>
            <textarea className="input" rows={2} maxLength={300} value={form.note} onChange={set('note')} placeholder="Banco de origen, titular de la cuenta…" />
          </Field>
          <Field
            label={mode === 'register' ? 'Soporte del pago (opcional)' : 'Comprobante o capture del pago (opcional)'}
            error={fieldErrors.proof}
            full
          >
            {payment.proof_path && !proofFile && mode === 'report' && (
              <div className="proof-current">
                <Icon name="paperclip" size={15} />
                <span>
                  Ya adjuntaste <strong>{payment.proof_original_name}</strong>. Si subes otro, lo reemplaza.
                </span>
                <ProofButton payment={payment} label="Ver" variant="ghost" />
              </div>
            )}
            <FileDropzone
              value={proofFile}
              onChange={setProofFile}
              accept={PROOF_ACCEPT}
              maxBytes={PROOF_MAX_BYTES}
              label="Arrastra aquí el capture o PDF del pago"
              hint="JPG, PNG o PDF · máximo 5 MB"
              disabled={loading}
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon="check" loading={loading} loadingText={config.loading} disabled={blockedByRate || quoting}>
            {config.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
