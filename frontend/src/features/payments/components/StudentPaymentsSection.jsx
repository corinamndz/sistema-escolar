import { useState } from 'react';
import Button from '../../../components/ui/Button';
import Table from '../../../components/ui/Table';
import Icon from '../../../components/ui/Icon';
import { ConversionBreakdown, DueDate, PaymentStatusBadge, REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { ProofButton } from './ProofViewer';
import ReceiptButton from './ReceiptButton';

// ---------------------------------------------------------------------------
// Agrupación y totales
// ---------------------------------------------------------------------------

/** "A" → "Sección A"; si el nombre ya dice "Sección…", se deja igual. */
const sectionLabel = (name) => (/^secci[oó]n/i.test(name) ? name : `Sección ${name}`);

/** Suma por moneda de cobro: [{ currency, total }] (nunca se suman monedas distintas). En centavos. */
export const totalsOf = (list) =>
  Object.entries(
    list.reduce((acc, p) => ({ ...acc, [p.currency]: (acc[p.currency] || 0) + Math.round(Number(p.amount) * 100) }), {})
  ).map(([currency, cents]) => ({ currency, total: cents / 100 }));

/**
 * Total en la moneda de referencia (columnas conv_* del backend). null si
 * alguna cuota no se pudo convertir (falta tasa) o quedaron en monedas
 * distintas: no se muestra un total parcial.
 */
export const refTotal = (list) => {
  const currencies = new Set(list.map((p) => p.conv_currency));
  if (list.length === 0 || currencies.size !== 1 || list.some((p) => p.conv_amount === null)) return null;
  return { currency: [...currencies][0], amount: list.reduce((n, p) => n + Math.round(Number(p.conv_amount) * 100), 0) / 100 };
};

const BUCKET_OF = { overdue: 'overdue', pending: 'pending', reported: 'pending', scheduled: 'upcoming' };

/**
 * Agrupa los pagos del representante por alumno, en el orden del portal
 * (principal primero). Incluye a los alumnos sin cobros y, al final, a los
 * que tienen cobros a nombre del representante pero ya no figuran en su
 * lista (ej. se desvinculó el alumno), para no esconder deudas.
 */
export function groupByStudent(payments, students = []) {
  const groups = new Map();
  const ensure = (id, data) => {
    if (!groups.has(id)) groups.set(id, { ...data, payments: [] });
    return groups.get(id);
  };
  students.forEach((s) =>
    ensure(s.id, {
      id: s.id,
      name: `${s.first_name} ${s.last_name}`,
      grade: s.section_id ? `${s.grade_name} · ${sectionLabel(s.section_name)}` : null,
      period: s.school_period_name,
      levelCode: s.level_code,
    })
  );
  payments.forEach((p) =>
    ensure(p.student_id, { id: p.student_id, name: `${p.student_first_name} ${p.student_last_name}`, grade: null, period: null }).payments.push(p)
  );

  return [...groups.values()].map((g) => {
    const buckets = { overdue: [], pending: [], upcoming: [], paid: [] };
    g.payments.forEach((p) => buckets[BUCKET_OF[p.display_status] || 'paid'].push(p));
    // Pagados: el más reciente primero.
    buckets.paid.sort((a, b) => String(b.paid_at || '').localeCompare(String(a.paid_at || '')));
    return { ...g, buckets, due: [...buckets.overdue, ...buckets.pending] };
  });
}

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// ---------------------------------------------------------------------------
// Tarjeta de una cuota por pagar
// ---------------------------------------------------------------------------

function PayCard({ payment: p, onReport }) {
  return (
    <article className={`pay-card pay-card--${p.display_status}`}>
      <div className="pay-card__head">
        <div className="pay-card__concept">{p.period_label}</div>
        <PaymentStatusBadge payment={p} />
      </div>
      <div className="pay-card__amount">{formatMoney(p.amount, p.currency)}</div>
      <ConversionBreakdown payment={p} />
      <div className="pay-card__due">
        <span className="student-card__label">Fecha límite</span>
        <DueDate payment={p} />
      </div>
      {p.display_status === 'reported' && (
        <div className="pay-card__reported">
          <Icon name="info" size={15} />
          <span>
            Reportado el {formatDate(p.reported_at)} ({REPORT_METHODS[p.report_method]}
            {p.report_reference ? ` · ref. ${p.report_reference}` : ''}). En revisión por administración.
          </span>
        </div>
      )}
      {p.proof_path && <ProofButton payment={p} label="Ver mi comprobante" variant="ghost" />}
      <Button variant={p.display_status === 'reported' ? 'secondary' : 'primary'} icon="receipt" className="btn--block" onClick={() => onReport(p)}>
        {p.display_status === 'reported' ? 'Corregir reporte' : 'Reportar pago'}
      </Button>
    </article>
  );
}

const paidColumns = [
  { key: 'period_label', header: 'Concepto', render: (p) => <span className="cell-person__name">{p.period_label}</span> },
  {
    key: 'amount',
    header: 'Monto',
    align: 'right',
    render: (p) => (
      <div className="amount-cell">
        <span>{formatMoney(p.amount, p.currency)}</span>
        <ConversionBreakdown payment={p} compact />
      </div>
    ),
  },
  { key: 'status', header: 'Estado', render: (p) => <PaymentStatusBadge payment={p} /> },
  { key: 'paid_at', header: 'Fecha de pago', render: (p) => formatDate(p.paid_at) },
  {
    key: 'receipt',
    header: 'Comprobante',
    render: (p) =>
      p.receipt_url ? (
        <ReceiptButton paymentId={p.id} />
      ) : (
        '—'
      ),
  },
];

// ---------------------------------------------------------------------------
// Sección de un alumno
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'overdue', label: 'Vencidos', empty: 'No hay cuotas vencidas.' },
  { key: 'pending', label: 'Por pagar', empty: 'No hay cuotas por pagar en este momento.' },
  { key: 'upcoming', label: 'Próximas', empty: 'No hay mensualidades programadas.' },
  { key: 'paid', label: 'Pagados', empty: 'Todavía no hay pagos confirmados.' },
];

/**
 * Cabecera (alumno, grado/sección, estado y total pendiente en USD y en la
 * moneda elegida) + pestañas con sus cuotas. Las acciones (reportar, ver
 * comprobante) quedan dentro de la sección del alumno al que pertenecen.
 */
export function StudentPaymentsSection({ group, onReport }) {
  const { buckets } = group;
  // Se abre en lo más urgente: vencidos → por pagar → pagados → próximas.
  const firstTab = ['overdue', 'pending', 'paid', 'upcoming'].find((k) => buckets[k].length) || 'pending';
  const [tab, setTab] = useState(firstTab);
  // "Vencidos" solo se muestra si hay (o si es la pestaña abierta).
  const tabs = TABS.filter((t) => t.key !== 'overdue' || buckets.overdue.length > 0 || tab === 'overdue');
  const current = TABS.find((t) => t.key === tab);
  const list = buckets[tab];

  const dueUsd = totalsOf(group.due);
  const dueRef = refTotal(group.due);
  const status = buckets.overdue.length
    ? { tone: 'danger', icon: 'alertTriangle', text: `${buckets.overdue.length} vencido${buckets.overdue.length === 1 ? '' : 's'}` }
    : group.due.length
      ? { tone: 'warning', icon: 'wallet', text: `${group.due.length} por pagar` }
      : { tone: 'success', icon: 'checkCircle', text: 'Al día' };
  const panelId = `student-pay-${group.id}`;

  return (
    <section className={`student-pay student-pay--${status.tone}`} id={`alumno-${group.id}`} aria-labelledby={`${panelId}-title`}>
      <header className="student-pay__head">
        <span className="avatar">{initials(group.name)}</span>
        <div className="student-pay__who">
          <h3 id={`${panelId}-title`}>{group.name}</h3>
          <div className="cell-person__sub">
            {group.grade ? `${group.grade}${group.period ? ` · ${group.period}` : ''}` : 'Sin inscripción vigente'}
          </div>
        </div>
        <span className={`student-pay__status student-pay__status--${status.tone}`}>
          <Icon name={status.icon} size={15} /> {status.text}
        </span>
        <div className="student-pay__totals">
          <span className="student-card__label">Pendiente</span>
          <strong>{group.due.length ? formatAmounts(dueUsd) : formatMoney(0, 'USD')}</strong>
          {dueRef && dueRef.currency !== 'USD' && <span className="cell-person__sub">≈ {formatMoney(dueRef.amount, dueRef.currency)} a la tasa de hoy</span>}
        </div>
      </header>

      <div className="student-pay__tabs" role="tablist" aria-label={`Cuotas de ${group.name}`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${panelId}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${panelId}-panel`}
            className={`student-pay__tab ${tab === t.key ? 'is-active' : ''} ${t.key === 'overdue' ? 'student-pay__tab--danger' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="student-pay__count">{buckets[t.key].length}</span>
          </button>
        ))}
      </div>

      <div className="student-pay__body" role="tabpanel" id={`${panelId}-panel`} aria-labelledby={`${panelId}-tab-${tab}`}>
        {list.length === 0 ? (
          <p className="student-pay__empty">
            <Icon name="checkCircle" size={16} /> {current.empty}
          </p>
        ) : tab === 'paid' ? (
          <Table columns={paidColumns} rows={list} />
        ) : tab === 'upcoming' ? (
          <ul className="upcoming-list">
            {list.map((p) => (
              <li key={p.id}>
                <span className="cell-person__name">{p.period_label}</span>
                <span>
                  {formatMoney(p.amount, p.currency)} <ConversionBreakdown payment={p} compact />
                </span>
                <span className="text-muted">Vence el {formatDate(p.due_date, false)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="pay-cards">
            {list.map((p) => (
              <PayCard key={p.id} payment={p} onReport={onReport} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
