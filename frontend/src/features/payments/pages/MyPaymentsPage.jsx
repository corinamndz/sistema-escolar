import { useMemo, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import portalApi from '../../../api/endpoints/portal.api';
import { BillingNotice } from '../../dashboard/components/GuardianPanel';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { RateBanner } from '../components/ExchangeRatePanel';
import { useRateAutoRefresh } from '../useRateAutoRefresh';
import { PaymentFormModal } from '../components/PaymentForms';
import { StudentPaymentsSection, groupByStudent, refTotal, totalsOf } from '../components/StudentPaymentsSection';
import { ViewCurrencySelect } from '../currency';
import { useViewCurrency } from '../useViewCurrency';
import Button from '../../../components/ui/Button';
import { BatchCartBar, BatchPaymentDrawer, MyBatches, isBatchable } from '../components/BatchPayment';

/**
 * Vista de padres: los pagos del representante agrupados por alumno. El
 * backend resuelve qué pagos son suyos por `guardians.user_id = req.user.id`,
 * no por un filtro que el frontend pueda manipular.
 *
 * Los montos en moneda local los calcula el backend con la tasa del día de la
 * moneda elegida en "Ver montos en…" (columnas conv_*).
 *
 * Pago agrupado: la familia marca varias cuotas (de uno o varios hijos), ve el
 * total en la barra inferior y las paga en una sola operación con un
 * comprobante (BatchPayment.jsx); administración lo aprueba completo.
 */
function MyPaymentsPage() {
  const { data: rates, refetch: refetchRates } = useFetch(() => paymentsApi.currentRate(), []);
  // Moneda en que la familia quiere ver sus cuotas (se recuerda en el navegador).
  const [viewCurrency, setViewCurrency] = useViewCurrency('myPayments.viewCurrency', rates);
  const { data: rows, loading, error, refetch } = useFetch(
    () => paymentsApi.listMine(viewCurrency ? { currency: viewCurrency } : undefined),
    [viewCurrency]
  );
  // Tasa nueva o llegada de su fecha valor: tasas y montos convertidos al día.
  useRateAutoRefresh(rates, () => {
    refetchRates();
    refetch();
  });
  // Alumnos del representante con grado/sección (y avisos de facturación).
  const { data: portal, loading: loadingPortal } = useFetch(() => portalApi.getMine(), []);
  const [reporting, setReporting] = useState(null);
  const { data: batches, refetch: refetchBatches } = useFetch(() => paymentsApi.myBatches(), []);
  // Selección para el pago agrupado: id → cuota (de cualquier alumno).
  const [picked, setPicked] = useState(() => new Map());
  const [payingBatch, setPayingBatch] = useState(false);

  const groups = useMemo(() => groupByStudent(rows || [], portal?.students || []), [rows, portal]);
  // Al recargar, la selección se queda solo con cuotas que siguen disponibles (con sus montos al día).
  const selected = useMemo(() => {
    const available = new Map((rows || []).filter(isBatchable).map((p) => [p.id, p]));
    return [...picked.keys()].map((id) => available.get(id)).filter(Boolean);
  }, [picked, rows]);
  const selection = useMemo(
    () => ({
      ids: new Set(selected.map((p) => p.id)),
      toggle: (p) =>
        setPicked((m) => {
          const next = new Map(m);
          if (next.has(p.id)) next.delete(p.id);
          else next.set(p.id, p);
          return next;
        }),
    }),
    [selected]
  );
  const batchable = (rows || []).filter(isBatchable);
  const selectAllDue = () => setPicked(new Map(batchable.map((p) => [p.id, p])));
  const refreshAll = () => {
    refetch();
    refetchBatches();
  };

  if ((loading && !rows) || (loadingPortal && !portal)) return <Spinner label="Cargando tus pagos…" />;

  const billingIssues = portal?.billing_issues || [];
  const due = groups.flatMap((g) => g.due);
  const overdueCount = groups.reduce((n, g) => n + g.buckets.overdue.length, 0);
  const nextUpcoming = groups
    .flatMap((g) => g.buckets.upcoming)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  const dueRef = refTotal(due);

  return (
    <div>
      <PageHeader
        title="Mis pagos"
        subtitle="Mensualidades y cobros de cada uno de tus representados. Cada mes vence en sus primeros 5 días."
        actions={<ViewCurrencySelect value={viewCurrency} onChange={setViewCurrency} status={rates} />}
      />
      <Alert>{error}</Alert>

      <RateBanner exchange={rates} />
      {billingIssues.length > 0 && <BillingNotice issues={billingIssues} />}

      {/* Resumen general de la familia */}
      <div className={`pay-banner ${overdueCount ? 'pay-banner--overdue' : due.length || billingIssues.length ? 'pay-banner--due' : 'pay-banner--ok'}`}>
        <Icon name={overdueCount ? 'alertTriangle' : due.length ? 'wallet' : 'checkCircle'} size={22} />
        <div>
          <strong>
            {overdueCount
              ? `Tienes ${overdueCount} pago${overdueCount === 1 ? '' : 's'} vencido${overdueCount === 1 ? '' : 's'}`
              : due.length
                ? `Tienes ${due.length} pago${due.length === 1 ? '' : 's'} pendiente${due.length === 1 ? '' : 's'}`
                : billingIssues.length
                  ? 'Estado de cuenta en preparación'
                  : 'Estás al día con tus pagos'}
          </strong>
          <div className="text-sm">
            {due.length
              ? `Total por pagar: ${formatAmounts(totalsOf(due))}${dueRef && dueRef.currency !== 'USD' ? ` · ≈ ${formatMoney(dueRef.amount, dueRef.currency)} a la tasa de hoy` : ''}`
              : nextUpcoming
                ? `Próxima mensualidad: ${nextUpcoming.period_label}, vence el ${formatDate(nextUpcoming.due_date)}.`
                : '¡Gracias!'}
          </div>
        </div>
        {batchable.length > 1 && (
          <Button variant="secondary" icon="layers" className="pay-banner__action" onClick={selected.length === batchable.length ? () => setPicked(new Map()) : selectAllDue}>
            {selected.length === batchable.length ? 'Quitar selección' : `Pagar todo junto (${batchable.length})`}
          </Button>
        )}
      </div>

      {batchable.length > 1 && !selected.length && (
        <p className="batch-hint">
          <Icon name="info" size={14} /> Puedes marcar varias cuotas, de uno o varios de tus representados, y pagarlas en una sola operación con un solo comprobante.
        </p>
      )}

      <MyBatches batches={batches} onChanged={refreshAll} />

      {/* Accesos rápidos a cada alumno (solo con más de uno) */}
      {groups.length > 1 && (
        <nav className="student-jump" aria-label="Ir a los pagos de cada alumno">
          {groups.map((g) => (
            <a
              key={g.id}
              href={`#alumno-${g.id}`}
              className={`student-jump__item ${g.buckets.overdue.length ? 'is-overdue' : g.due.length ? 'is-due' : 'is-ok'}`}
            >
              <span className="student-jump__dot" aria-hidden="true" />
              {g.name.split(' ')[0]}
              <span className="text-muted">
                {g.buckets.overdue.length ? `${g.buckets.overdue.length} vencido(s)` : g.due.length ? `${g.due.length} por pagar` : 'al día'}
              </span>
            </a>
          ))}
        </nav>
      )}

      {groups.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="users" size={24} />
          </div>
          <div className="empty-state__title">No tienes alumnos asociados</div>
          <div className="text-sm">Si representas a un alumno del colegio, pide a administración que te asocie.</div>
        </div>
      ) : (
        <div className="student-pay-list">
          {groups.map((g) => (
            <StudentPaymentsSection key={g.id} group={g} onReport={setReporting} selection={selection} />
          ))}
        </div>
      )}

      {reporting && <PaymentFormModal payment={reporting} mode="report" onClose={() => setReporting(null)} onDone={refetch} />}

      <BatchCartBar selected={selected} onClear={() => setPicked(new Map())} onPay={() => setPayingBatch(true)} />
      {payingBatch && (
        <BatchPaymentDrawer
          payments={selected}
          onClose={() => setPayingBatch(false)}
          onDone={() => {
            setPicked(new Map());
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

export default MyPaymentsPage;
