import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import portalApi from '../../../api/endpoints/portal.api';
import { BillingNotice } from '../../dashboard/components/GuardianPanel';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { BsBreakdown, DueDate, PaymentStatusBadge, REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { RateBanner } from '../components/ExchangeRatePanel';
import { PaymentFormModal } from '../components/PaymentForms';
import { ProofButton } from '../components/ProofViewer';

const DUE = ['pending', 'overdue', 'reported'];

/** Total en Bs de las cuotas (null si alguna no tiene tasa: no se muestra un total parcial). */
const vesTotal = (list) =>
  list.some((p) => p.ves_amount === null) ? null : list.reduce((n, p) => n + Number(p.ves_amount), 0);

/** Suma por moneda de una lista de pagos. */
const totalsOf = (list) =>
  Object.entries(list.reduce((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] || 0) + Number(p.amount) }), {})).map(
    ([currency, total]) => ({ currency, total })
  );

/**
 * Vista de padres: un representante ve solo los pagos a su nombre (el backend
 * resuelve esto por `guardians.user_id = req.user.id`, no por un filtro que el
 * frontend pueda manipular).
 */
function MyPaymentsPage() {
  const { data: rows, loading, error, refetch } = useFetch(() => paymentsApi.listMine(), []);
  const { data: portal } = useFetch(() => portalApi.getMine(), []);
  const billingIssues = portal?.billing_issues || [];
  const [reporting, setReporting] = useState(null);

  if (loading) return <Spinner label="Cargando tus pagos…" />;

  const payments = rows || [];
  const due = payments.filter((p) => DUE.includes(p.display_status));
  const upcoming = payments.filter((p) => p.display_status === 'scheduled');
  const history = payments.filter((p) => !DUE.includes(p.display_status) && p.display_status !== 'scheduled');
  const overdue = due.filter((p) => p.display_status === 'overdue');

  const historyColumns = [
    { key: 'period_label', header: 'Concepto', render: (p) => <span className="cell-person__name">{p.period_label}</span> },
    { key: 'student', header: 'Alumno', render: (p) => `${p.student_first_name} ${p.student_last_name}` },
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      render: (p) => (
        <div className="amount-cell">
          <span>{formatMoney(p.amount, p.currency)}</span>
          <BsBreakdown payment={p} compact />
        </div>
      ),
      sortValue: (p) => Number(p.amount),
    },
    { key: 'status', header: 'Estado', render: (p) => <PaymentStatusBadge payment={p} /> },
    { key: 'paid_at', header: 'Fecha de pago', render: (p) => formatDate(p.paid_at), sortValue: (p) => p.paid_at },
    {
      key: 'receipt',
      header: 'Comprobante',
      render: (p) =>
        p.receipt_url ? (
          <a href={p.receipt_url} target="_blank" rel="noreferrer" className="link-icon">
            <Icon name="receipt" size={15} /> Descargar PDF
          </a>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="Mis pagos" subtitle="Mensualidades y cobros de tus representados. Cada mes vence en sus primeros 5 días." />
      <Alert>{error}</Alert>

      <RateBanner exchange={portal?.exchange} />
      {billingIssues.length > 0 && <BillingNotice issues={billingIssues} />}

      <div
        className={`pay-banner ${
          overdue.length ? 'pay-banner--overdue' : due.length || billingIssues.length ? 'pay-banner--due' : 'pay-banner--ok'
        }`}
      >
        <Icon name={overdue.length ? 'alertTriangle' : due.length ? 'wallet' : 'checkCircle'} size={22} />
        <div>
          <strong>
            {overdue.length
              ? `Tienes ${overdue.length} pago${overdue.length === 1 ? '' : 's'} vencido${overdue.length === 1 ? '' : 's'}`
              : due.length
                ? `Tienes ${due.length} pago${due.length === 1 ? '' : 's'} pendiente${due.length === 1 ? '' : 's'}`
                : billingIssues.length
                  ? 'Estado de cuenta en preparación'
                  : 'Estás al día con tus pagos'}
          </strong>
          <div className="text-sm">
            {due.length ? `Total por pagar: ${formatAmounts(totalsOf(due))}${vesTotal(due) ? ` · ${formatMoney(vesTotal(due), 'VES')} a la tasa de hoy` : ''}` : upcoming.length ? `Próxima mensualidad: ${upcoming[0].period_label}, vence el ${formatDate(upcoming[0].due_date)}.` : '¡Gracias!'}
          </div>
        </div>
      </div>

      <Card title="Pagos pendientes" subtitle="Si ya pagaste, repórtalo para que administración lo confirme.">
        {due.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="checkCircle" size={24} />
            </div>
            <div className="empty-state__title">No tienes pagos pendientes</div>
          </div>
        ) : (
          <div className="pay-cards">
            {due.map((p) => (
              <article key={p.id} className={`pay-card pay-card--${p.display_status}`}>
                <div className="pay-card__head">
                  <div>
                    <div className="pay-card__concept">{p.period_label}</div>
                    <div className="cell-person__sub">
                      {p.student_first_name} {p.student_last_name}
                    </div>
                  </div>
                  <PaymentStatusBadge payment={p} />
                </div>
                <div className="pay-card__amount">{formatMoney(p.amount, p.currency)}</div>
                <BsBreakdown payment={p} />
                <div className="pay-card__due">
                  <span className="student-card__label">Fecha límite</span>
                  <DueDate payment={p} />
                </div>
                {p.display_status === 'reported' ? (
                  <div className="pay-card__reported">
                    <Icon name="info" size={15} />
                    <span>
                      Reportado el {formatDate(p.reported_at)} ({REPORT_METHODS[p.report_method]}
                      {p.report_reference ? ` · ref. ${p.report_reference}` : ''}). En revisión por administración.
                    </span>
                  </div>
                ) : null}
                {p.proof_path ? (
                  <ProofButton payment={p} label="Ver mi comprobante" variant="ghost" />
                ) : null}
                <Button
                  variant={p.display_status === 'reported' ? 'secondary' : 'primary'}
                  icon="receipt"
                  className="btn--block"
                  onClick={() => setReporting(p)}
                >
                  {p.display_status === 'reported' ? 'Corregir reporte' : 'Reportar pago'}
                </Button>
              </article>
            ))}
          </div>
        )}
      </Card>

      {upcoming.length > 0 && (
        <Card title="Próximas mensualidades" subtitle="Se podrán pagar a partir del día 1 de cada mes.">
          <ul className="upcoming-list">
            {upcoming.map((p) => (
              <li key={p.id}>
                <span className="cell-person__name">{p.period_label}</span>
                <span className="text-muted">
                  {p.student_first_name} {p.student_last_name}
                </span>
                <span>
                  {formatMoney(p.amount, p.currency)} <BsBreakdown payment={p} compact />
                </span>
                <span className="text-muted">Vence el {formatDate(p.due_date, false)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Historial">
        <Table columns={historyColumns} rows={history} emptyMessage="Todavía no hay pagos confirmados." />
      </Card>

      {reporting && (
        <PaymentFormModal payment={reporting} mode="report" onClose={() => setReporting(null)} onDone={refetch} />
      )}
    </div>
  );
}

export default MyPaymentsPage;
