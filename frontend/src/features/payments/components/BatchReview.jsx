import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { REPORT_METHODS, formatDate, formatMoney } from '../paymentStatus';
import { CurrencySelect } from '../currency';
import { ProofViewerModal } from './ProofViewer';
import { BATCH_STATUS } from './BatchPayment';

const ymd = (v) => (v ? String(v).slice(0, 10) : '');

/**
 * Pagos agrupados por revisar (arriba de la tabla de Pagos): uno por fila con
 * la familia, el total y cuántas cuotas/alumnos; "Revisar" abre el detalle.
 */
export function PendingBatches({ batches, onReview }) {
  if (!batches?.length) return null;
  return (
    <section className="card pending-batches" aria-label="Pagos agrupados por revisar">
      <div className="pending-batches__head">
        <Icon name="layers" size={18} />
        <strong>
          {batches.length} pago{batches.length === 1 ? '' : 's'} agrupado{batches.length === 1 ? '' : 's'} por revisar
        </strong>
        <span className="text-sm text-muted">Al aprobar uno, todas sus cuotas quedan pagadas con su recibo.</span>
      </div>
      <ul>
        {batches.map((b) => (
          <li key={b.id}>
            <div>
              <div className="cell-person__name">{b.guardian_name}</div>
              <div className="cell-person__sub">
                {b.item_count} cuota{b.item_count === 1 ? '' : 's'}
                {b.student_count > 1 ? ` de ${b.student_count} alumnos` : ''} · {REPORT_METHODS[b.method]}
                {b.reference ? ` · ref. ${b.reference}` : ''} · {formatDate(b.reported_at)}
                {b.has_proof && (
                  <>
                    {' · '}
                    <Icon name="paperclip" size={11} /> con comprobante
                  </>
                )}
              </div>
            </div>
            <div className="pending-batches__amount">
              <strong>{formatMoney(b.base_total, b.base_currency)}</strong>
              {b.ref_total !== null && b.ref_currency !== b.base_currency && <span className="cell-person__sub">≈ {formatMoney(b.ref_total, b.ref_currency)}</span>}
            </div>
            <Button size="sm" onClick={() => onReview(b.id)}>
              Revisar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Revisión de un pago agrupado: cuotas por alumno, datos del pago y comprobante.
 * Aprobar confirma TODAS las cuotas (una transacción: si una falla, ninguna);
 * rechazar las devuelve a "por pagar" con el motivo, que ve la familia.
 */
export function BatchReviewDrawer({ batchId, canApprove, onClose, onDone }) {
  const toast = useToast();
  const { data: b, loading, error } = useFetch(() => paymentsApi.getBatch(batchId), [batchId]);
  const { data: rates } = useFetch(() => paymentsApi.currentRate(), []);
  const [form, setForm] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [proofOpen, setProofOpen] = useState(false);
  const approve = useMutation((details) => paymentsApi.approveBatch(batchId, details));
  const reject = useMutation((text) => paymentsApi.rejectBatch(batchId, text));

  // Formulario con los datos que reportó la familia (la administración puede corregirlos).
  if (b && !form) setForm({ method: b.method, reference: b.reference || '', paidOn: ymd(b.paid_on), currency: b.ref_currency || null });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const byStudent = (b?.items || []).reduce((acc, i) => {
    (acc[i.student_name] ||= []).push(i);
    return acc;
  }, {});

  const doApprove = async () => {
    try {
      const r = await approve.run({ method: form.method, reference: form.reference.trim(), paidOn: form.paidOn, currency: form.currency || undefined });
      const solvent = r.solvency.filter((s) => s.solvent).map((s) => s.first_name);
      const owing = r.solvency.filter((s) => !s.solvent).map((s) => `${s.first_name} (${s.pending_count} pendiente${s.pending_count === 1 ? '' : 's'})`);
      toast.success(
        'Pago agrupado aprobado',
        `${r.batch.item_count} cuotas pagadas. ${solvent.length ? `Solventes: ${solvent.join(', ')}.` : ''}${owing.length ? ` Aún deben: ${owing.join(', ')}.` : ''}${r.emailSent ? ' Recibos enviados por correo.' : ''}`
      );
      onDone?.();
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  const doReject = async () => {
    try {
      await reject.run(reason.trim());
      toast.success('Pago agrupado rechazado', 'La familia recibió el motivo; sus cuotas vuelven a estar por pagar.');
      onDone?.();
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  const reviewing = b?.status === 'reported';
  return (
    <Drawer title="Pago agrupado" subtitle={b ? `${b.guardian_name} · ${b.item_count} cuotas` : undefined} icon="layers" size="lg" onClose={onClose}>
      <Alert>{error}</Alert>
      {loading || !b || !form ? (
        <Spinner />
      ) : (
        <div className="batch-review">
          <div className="batch-review__top">
            <div>
              <div className="batch-review__total">{formatMoney(b.base_total, b.base_currency)}</div>
              {b.ref_total !== null && b.ref_currency !== b.base_currency && (
                <div className="text-sm text-muted">
                  {b.status === 'approved' ? 'Pagado: ' : '≈ '}
                  {formatMoney(b.ref_total, b.ref_currency)}
                </div>
              )}
            </div>
            <Badge variant={BATCH_STATUS[b.status].variant}>{BATCH_STATUS[b.status].label}</Badge>
          </div>

          <dl className="batch-review__facts">
            <div>
              <dt>Reportado</dt>
              <dd>{formatDate(b.reported_at)}</dd>
            </div>
            <div>
              <dt>Método</dt>
              <dd>
                {REPORT_METHODS[b.method]}
                {b.reference ? ` · ref. ${b.reference}` : ''}
              </dd>
            </div>
            <div>
              <dt>Fecha de pago</dt>
              <dd>{formatDate(b.paid_on)}</dd>
            </div>
            <div>
              <dt>Comprobante</dt>
              <dd>
                {b.has_proof ? (
                  <button type="button" className="link-button" onClick={() => setProofOpen(true)}>
                    <Icon name="paperclip" size={13} /> {b.proof_original_name || 'Ver comprobante'}
                  </button>
                ) : (
                  'Sin comprobante'
                )}
              </dd>
            </div>
            {b.note && (
              <div className="batch-review__wide">
                <dt>Nota de la familia</dt>
                <dd>{b.note}</dd>
              </div>
            )}
            {b.rejection_reason && (
              <div className="batch-review__wide">
                <dt>Motivo del rechazo</dt>
                <dd>{b.rejection_reason}</dd>
              </div>
            )}
          </dl>

          <div className="batch-summary">
            {Object.entries(byStudent).map(([name, items]) => (
              <section key={name} className="batch-summary__student">
                <h4>
                  <Icon name="user" size={14} /> {name}
                </h4>
                <ul>
                  {items.map((i) => (
                    <li key={i.payment_id}>
                      <span>
                        {i.period_label}
                        <small className="text-muted"> · vence el {formatDate(i.due_date, false)}</small>
                        {i.status === 'paid' && <Badge variant="success">Pagada</Badge>}
                      </span>
                      <strong>
                        {formatMoney(i.amount, i.currency)}
                        {i.ref_amount !== null && i.ref_currency !== i.currency && i.status === 'paid' && <small className="text-muted"> · {formatMoney(i.ref_amount, i.ref_currency)}</small>}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {reviewing && canApprove && !rejecting && (
            <>
              <h4 className="batch-review__section">Confirmar pago</h4>
              <p className="form-hint">Verifica el comprobante y la operación en el banco. Puedes corregir los datos antes de aprobar.</p>
              <div className="form-grid">
                <Field label="Moneda en que pagó">
                  <CurrencySelect value={form.currency} onChange={(currency) => setForm((f) => ({ ...f, currency }))} status={rates} disabled={!rates} />
                </Field>
                <Field label="Fecha de pago" hint="Se usa la tasa vigente ese día.">
                  <Input type="date" value={form.paidOn} onChange={set('paidOn')} />
                </Field>
                <Field label="Método">
                  <Select value={form.method} onChange={set('method')}>
                    {Object.entries(REPORT_METHODS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Referencia">
                  <Input value={form.reference} onChange={set('reference')} maxLength={60} />
                </Field>
              </div>
              <Alert>{approve.error}</Alert>
              <div className="form-actions">
                <Button type="button" variant="secondary" icon="x" onClick={() => setRejecting(true)}>
                  Rechazar
                </Button>
                <Button icon="checkCircle" loading={approve.loading} loadingText="Aprobando…" onClick={doApprove}>
                  Aprobar y marcar {b.item_count} cuota{b.item_count === 1 ? '' : 's'} pagada{b.item_count === 1 ? '' : 's'}
                </Button>
              </div>
            </>
          )}

          {reviewing && canApprove && rejecting && (
            <>
              <h4 className="batch-review__section">Rechazar pago agrupado</h4>
              <Field label="Motivo (lo verá la familia)" error={reject.fieldErrors.reason} required>
                <textarea className="input" rows={3} maxLength={280} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. La referencia no aparece en el estado de cuenta del banco." />
              </Field>
              <Alert>{reject.error}</Alert>
              <div className="form-actions">
                <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
                  Volver
                </Button>
                <Button variant="danger" icon="x" loading={reject.loading} disabled={reason.trim().length < 5} onClick={doReject}>
                  Rechazar y avisar a la familia
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {proofOpen && b && (
        <ProofViewerModal
          payment={{ id: b.id, proof_mime: b.proof_mime, proof_original_name: b.proof_original_name, period_label: `Pago agrupado · ${b.item_count} cuotas`, proof_uploaded_at: b.proof_uploaded_at }}
          load={() => paymentsApi.getBatchProofBlob(b.id)}
          onClose={() => setProofOpen(false)}
        />
      )}
    </Drawer>
  );
}
