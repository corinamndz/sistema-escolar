import paymentsApi from '../../../api/endpoints/payments.api';
import { useFetch } from '../../../hooks/useFetch';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { ConversionBreakdown, DueDate, PaymentStatusBadge, REPORT_METHODS, formatDate, formatMoney } from '../paymentStatus';
import { ProofButton } from './ProofViewer';
import ReceiptButton from './ReceiptButton';

/** Eventos del cobro en orden cronológico, a partir de sus fechas. */
function timelineOf(p) {
  const events = [{ date: p.created_at, icon: 'plus', label: 'Cobro generado', detail: p.kind === 'tuition' ? 'Mensualidad automática' : 'Cargo manual' }];
  if (p.issue_date) events.push({ date: p.issue_date, icon: 'clipboard', label: 'Exigible desde', detail: null });
  if (p.due_date) events.push({ date: p.due_date, icon: 'alertCircle', label: 'Fecha límite de pago', detail: null });
  if (p.reported_at) {
    events.push({
      date: p.reported_at,
      icon: 'receipt',
      label: 'Pago reportado',
      detail: [
        REPORT_METHODS[p.report_method],
        p.report_reference && `ref. ${p.report_reference}`,
        p.report_paid_on && `pagado el ${formatDate(p.report_paid_on)}`,
        p.proof_path && 'con comprobante adjunto',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (p.paid_at) {
    events.push({
      date: p.paid_at,
      icon: 'checkCircle',
      label: 'Pago confirmado',
      detail:
        p.conv_amount && p.conv_currency !== p.currency
          ? `${formatMoney(p.conv_amount, p.conv_currency)} con la tasa del ${formatDate(p.conv_rate_date)}`
          : p.conv_currency === 'USD'
            ? 'Pagado en dólares'
            : null,
    });
  }
  if (p.cancelled_at) events.push({ date: p.cancelled_at, icon: 'x', label: 'Cobro anulado', detail: null });
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Detalle de un cobro: desglose monto USD × tasa del día = total en la moneda de referencia, datos del pago, cronología
 * y, si se puede, los demás cobros del mismo alumno.
 */
export function PaymentDetailModal({ payment: p, showStudentHistory = true, actions = null, onClose }) {
  const { data: others, loading } = useFetch(
    () => (showStudentHistory ? paymentsApi.list({ studentId: p.student_id }) : Promise.resolve([])),
    [p.student_id, showStudentHistory]
  );
  const siblings = (others || []).filter((o) => o.id !== p.id && o.status !== 'cancelled').slice(0, 8);

  return (
    <Modal title={p.period_label} onClose={onClose} size="lg">
      <div className="detail__intro">
        <PaymentStatusBadge payment={p} />
        <span className="text-muted">
          {p.student_first_name} {p.student_last_name} · Responsable: {p.guardian_first_name} {p.guardian_last_name}
        </span>
      </div>

      <div className="payment-detail">
        <div>
          <h4 className="detail-section__title">
            <Icon name="wallet" size={16} /> Desglose
          </h4>
          <ConversionBreakdown payment={p} />
          {p.conv_estimated && p.conv_amount && (
            <p className="form-hint" style={{ marginTop: 6 }}>
              Estimado con la tasa vigente hoy: el monto definitivo en {p.conv_currency} se fija con la tasa de la fecha de pago.
            </p>
          )}
          <dl className="detail-list" style={{ marginTop: 12 }}>
            <div className="detail-list__item">
              <dt>Fecha límite</dt>
              <dd>
                <DueDate payment={p} />
              </dd>
            </div>
            <div className="detail-list__item">
              <dt>Tipo</dt>
              <dd>{p.kind === 'tuition' ? 'Mensualidad' : 'Otro cobro'}</dd>
            </div>
            {(p.report_method || p.report_reference) && (
              <div className="detail-list__item detail-list__item--full">
                <dt>Datos del pago</dt>
                <dd>
                  {[REPORT_METHODS[p.report_method], p.report_reference && `Ref. ${p.report_reference}`, p.report_paid_on && `pagado el ${formatDate(p.report_paid_on)}`]
                    .filter(Boolean)
                    .join(' · ')}
                  {p.report_note && <div className="cell-person__sub">{p.report_note}</div>}
                </dd>
              </div>
            )}
          </dl>
          {p.proof_path && (
            <div className="proof-current" style={{ marginTop: 12 }}>
              <Icon name="paperclip" size={15} />
              <span>
                Soporte adjunto: <strong>{p.proof_original_name}</strong>
              </span>
              <ProofButton payment={p} label="Ver" variant="ghost" />
            </div>
          )}
          {p.receipt_url && (
            <ReceiptButton paymentId={p.id} label="Descargar comprobante" className="btn btn--secondary btn--sm" style={{ marginTop: 12 }} />
          )}
        </div>

        <div>
          <h4 className="detail-section__title">
            <Icon name="clipboard" size={16} /> Historial
          </h4>
          <ol className="timeline">
            {timelineOf(p).map((e, i) => (
              <li key={i}>
                <span className="timeline__icon">
                  <Icon name={e.icon} size={13} />
                </span>
                <div>
                  <strong>{e.label}</strong> <span className="text-muted">· {formatDate(e.date)}</span>
                  {e.detail && <div className="cell-person__sub">{e.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {showStudentHistory && (
        <div className="detail-section">
          <h4 className="detail-section__title">
            <Icon name="graduation" size={16} /> Otros cobros del alumno
          </h4>
          {loading ? (
            <Spinner label={null} />
          ) : siblings.length === 0 ? (
            <p className="text-muted text-sm">No hay otros cobros.</p>
          ) : (
            <ul className="upcoming-list">
              {siblings.map((o) => (
                <li key={o.id}>
                  <span className="cell-person__name">{o.period_label}</span>
                  <span>{formatMoney(o.amount, o.currency)}</span>
                  <PaymentStatusBadge payment={o} />
                  <span className="text-muted">{o.due_date ? `Vence ${formatDate(o.due_date, false)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        {actions}
      </div>
    </Modal>
  );
}
