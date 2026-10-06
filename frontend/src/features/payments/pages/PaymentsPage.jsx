import { useMemo, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import studentsApi from '../../../api/endpoints/students.api';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import StatCard from '../../../components/ui/StatCard';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { getErrorMessage } from '../../../api/axiosClient';
import { openReceipt } from '../components/ReceiptButton';
import { LEVELS, LEVEL_CODES } from '../../academics/levels';
import { ConversionBreakdown, DueDate, PaymentStatusBadge, REPORT_METHODS, formatAmounts, formatDate, formatMoney } from '../paymentStatus';
import { ExchangeRatePanel } from '../components/ExchangeRatePanel';
import { CurrencySelect, ViewCurrencySelect } from '../currency';
import { useViewCurrency } from '../useViewCurrency';
import { PaymentFormModal } from '../components/PaymentForms';
import { PaymentDetailModal } from '../components/PaymentDetailModal';
import { Link } from 'react-router-dom';

const FILTERS = [
  { key: 'due', label: 'Por cobrar' },
  { key: 'overdue', label: 'Vencidos' },
  { key: 'reported', label: 'Reportados' },
  { key: 'scheduled', label: 'Programados' },
  { key: 'paid', label: 'Pagados' },
  { key: 'cancelled', label: 'Anulados' },
  { key: '', label: 'Todos' },
];

function PaymentsPage() {
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [status, setStatus] = useState('due');
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  // Tasas de las monedas activas + moneda en que se muestran los equivalentes (se recuerda).
  const { data: rates, loading: loadingRates, refetch: refetchRates } = useFetch(() => paymentsApi.currentRate(), []);
  const [viewCurrency, setViewCurrency] = useViewCurrency('payments.viewCurrency', rates);
  const currencyParam = viewCurrency ? { currency: viewCurrency } : {};
  const params = { ...(status ? { status } : {}), ...(schoolPeriodId ? { schoolPeriodId } : {}), ...currencyParam };
  const { data: rows, loading, error, refetch } = useFetch(() => paymentsApi.list(params), [status, schoolPeriodId, viewCurrency]);
  const { data: summary, refetch: refetchSummary } = useFetch(
    () => paymentsApi.summary({ ...(schoolPeriodId ? { schoolPeriodId } : {}), ...currencyParam }),
    [schoolPeriodId, viewCurrency]
  );
  const [modal, setModal] = useState(null); // 'fees' | 'generate' | 'other'

  const reload = () => {
    refetch();
    refetchSummary();
    refetchRates();
  };

  const [viewing, setViewing] = useState(null); // cobro en "Ver detalle"
  const [paying, setPaying] = useState(null); // { payment, mode: 'register' | 'report' }

  const canRegister = can('payments', 'approve_payment');
  const canCancel = can('payments', 'update');
  // Un representante que llega a esta página solo puede REPORTAR sus propias cuotas.
  const isOwnPayment = (p) => Boolean(user?.guardianId) && p.guardian_id === user.guardianId;

  const handleCancel = async (p) => {
    const ok = await confirm({
      title: `¿Anular ${p.period_label}?`,
      message: `El cobro a ${p.student_first_name} ${p.student_last_name} dejará de ser exigible. Queda en el historial como anulado.`,
      danger: true,
      confirmLabel: 'Anular cobro',
    });
    if (!ok) return;
    try {
      await paymentsApi.cancel(p.id);
      toast.success('Cobro anulado', p.period_label);
      reload();
    } catch (err) {
      toast.error('No se pudo anular', getErrorMessage(err));
    }
  };

  const columns = [
    {
      key: 'student',
      header: 'Alumno',
      render: (p) => (
        <div>
          <div className="cell-person__name">
            {p.student_first_name} {p.student_last_name}
          </div>
          <div className="cell-person__sub">
            Resp.: {p.guardian_first_name} {p.guardian_last_name}
          </div>
        </div>
      ),
      sortValue: (p) => `${p.student_last_name} ${p.student_first_name}`,
    },
    {
      key: 'period_label',
      header: 'Concepto',
      render: (p) => (
        <div>
          <div>{p.period_label}</div>
          {p.kind === 'tuition' ? <span className="chip">Mensualidad</span> : <span className="chip">Otro cobro</span>}
        </div>
      ),
      sortValue: (p) => p.billing_month || p.period_label,
    },
    {
      key: 'amount',
      header: 'Monto',
      align: 'right',
      render: (p) => (
        <div className="amount-cell">
          <strong>{formatMoney(p.amount, p.currency)}</strong>
          <ConversionBreakdown payment={p} compact />
        </div>
      ),
      sortValue: (p) => Number(p.amount),
    },
    { key: 'due_date', header: 'Fecha límite', render: (p) => <DueDate payment={p} />, sortValue: (p) => p.due_date },
    {
      key: 'status',
      header: 'Estado',
      render: (p) => (
        <div>
          <PaymentStatusBadge payment={p} />
          {p.display_status === 'reported' && (
            <div className="cell-person__sub">
              {REPORT_METHODS[p.report_method]}
              {p.report_reference && ` · ${p.report_reference}`}
            </div>
          )}
          {p.proof_path && (
            <div className="cell-person__sub proof-flag" title={`Soporte adjunto: ${p.proof_original_name}`}>
              <Icon name="paperclip" size={12} /> Con soporte
            </div>
          )}
          {p.display_status === 'paid' && p.paid_at && <div className="cell-person__sub">{formatDate(p.paid_at)}</div>}
        </div>
      ),
      sortValue: (p) => p.display_status,
    },
  ];

  const pendingStatuses = ['pending', 'overdue', 'reported', 'scheduled'];
  const rowActions = [
    {
      key: 'register',
      icon: 'check',
      label: 'Registrar pago',
      tone: 'edit',
      show: (p) => canRegister && pendingStatuses.includes(p.display_status),
      onClick: (p) => setPaying({ payment: p, mode: 'register' }),
    },
    {
      key: 'report',
      icon: 'wallet',
      label: 'Reportar pago',
      tone: 'edit',
      show: (p) => !canRegister && isOwnPayment(p) && pendingStatuses.includes(p.display_status),
      onClick: (p) => setPaying({ payment: p, mode: 'report' }),
    },
    {
      key: 'receipt',
      icon: 'receipt',
      label: 'Ver comprobante',
      tone: 'view',
      show: (p) => Boolean(p.receipt_url),
      onClick: (p) => openReceipt(p.id).catch((err) => toast.error('No se pudo abrir el recibo', err.message)),
    },
    {
      key: 'cancel',
      icon: 'x',
      label: 'Anular cobro',
      tone: 'delete',
      show: (p) => canCancel && pendingStatuses.includes(p.display_status),
      onClick: handleCancel,
    },
  ];

  const dueTotal = summary && ['pending', 'overdue', 'reported'].reduce((n, s) => n + summary[s].count, 0);
  /**
   * "≈ COL$ 494.820,00" en la moneda de vista con su tasa vigente; vacío si
   * falta alguna tasa (no se muestra un total parcial). Suma en centavos.
   */
  const refHint = (statuses) => {
    if (!summary || statuses.every((s) => summary[s].count === 0)) return '';
    if (statuses.some((s) => summary[s].total_ref === null)) return '';
    if (summary.ref_currency === 'USD') return '';
    const cents = statuses.reduce((n, s) => n + Math.round(summary[s].total_ref * 100), 0);
    return `≈ ${formatMoney(cents / 100, summary.ref_currency)}`;
  };
  const dueAmounts = summary
    ? mergeAmounts(['pending', 'overdue', 'reported'].flatMap((s) => summary[s].amounts))
    : [];

  return (
    <div>
      <PageHeader
        title="Pagos"
        subtitle="Mensualidades y otros cobros. Cada mes se exige dentro de sus primeros 5 días."
        actions={
          <>
            <ViewCurrencySelect value={viewCurrency} onChange={setViewCurrency} status={rates} />
            {can('payments', 'update') && (
              <Button variant="secondary" icon="settings" onClick={() => setModal('fees')}>
                Tarifas
              </Button>
            )}
            {can('payments', 'create') && (
              <>
                <Button variant="secondary" icon="plus" onClick={() => setModal('other')}>
                  Otro cobro
                </Button>
                <Button icon="sparkles" onClick={() => setModal('generate')}>
                  Generar mensualidades
                </Button>
              </>
            )}
          </>
        }
      />

      {summary?.billing_issues?.length > 0 && (
        <div className="alert alert--warning billing-issues">
          <Icon name="alertTriangle" size={18} />
          <div>
            <strong>
              {summary.billing_issues.length} alumno(s) inscrito(s) sin mensualidades.
            </strong>{' '}
            Mientras no se corrija, su estado de cuenta muestra 0 pendientes.
            <ul>
              {summary.billing_issues.slice(0, 5).map((b) => (
                <li key={b.enrollment_id}>
                  {b.student_name} ({b.section}): {b.reasons.join(' ')}
                </li>
              ))}
              {summary.billing_issues.length > 5 && <li>…y {summary.billing_issues.length - 5} más.</li>}
            </ul>
            {can('payments', 'update') && summary.billing_issues.some((b) => b.reasons.some((r) => /tarifa/.test(r))) && (
              <Button size="sm" icon="settings" onClick={() => setModal('fees')}>
                Configurar tarifas
              </Button>
            )}
          </div>
        </div>
      )}

      {user?.guardianId && !canRegister && !canCancel && (
        <div className="alert alert--info">
          <Icon name="info" size={17} />
          <div>
            Para consultar y reportar los pagos de tus representados usa <Link to="/payments/mine">Mis pagos</Link>.
          </div>
        </div>
      )}

      <ExchangeRatePanel status={rates} loading={loadingRates} onChanged={reload} />

      <div className="grid grid--4" style={{ marginBottom: 24 }}>
        <StatCard label="Por cobrar" value={summary ? dueTotal : undefined} icon="wallet" tone="warning" hint={summary ? [formatAmounts(dueAmounts), refHint(['pending', 'overdue', 'reported'])].filter(Boolean).join(' · ') || '—' : ''} />
        <StatCard label="Vencidos" value={summary?.overdue.count} icon="alertCircle" tone="danger" hint={summary ? [formatAmounts(summary.overdue.amounts), refHint(['overdue'])].filter(Boolean).join(' · ') || 'Sin atrasos' : ''} />
        <StatCard label="Reportados por confirmar" value={summary?.reported.count} icon="receipt" tone="info" hint="Pagos informados por representantes" />
        <StatCard label="Cobrado" value={summary?.paid.count} icon="checkCircle" tone="success" hint={summary ? formatAmounts(summary.paid.amounts) || '—' : ''} />
      </div>

      <DataTable
        title={FILTERS.find((f) => f.key === status)?.label || 'Pagos'}
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar alumno, representante o concepto…"
        getSearchText={(p) =>
          [p.student_first_name, p.student_last_name, p.guardian_first_name, p.guardian_last_name, p.period_label, p.report_reference].join(' ')
        }
        filters={
          <>
            <div className="level-filter" role="group" aria-label="Estado">
              {FILTERS.map((f) => (
                <button
                  key={f.key || 'all'}
                  type="button"
                  className={`level-filter__item ${status === f.key ? 'level-filter__item--active' : ''}`}
                  onClick={() => setStatus(f.key)}
                  aria-pressed={status === f.key}
                >
                  {f.label}
                  {summary && f.key && f.key !== 'due' && summary[f.key] && (
                    <span className="level-filter__count">{summary[f.key].count}</span>
                  )}
                  {summary && f.key === 'due' && <span className="level-filter__count">{dueTotal}</span>}
                </button>
              ))}
            </div>
            <Select sorted value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)} aria-label="Año escolar">
              <option value="">Todos los años escolares</option>
              {(periods || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        }
        emptyMessage={
          status === 'due'
            ? 'No hay pagos por cobrar. Si aún no generaste las mensualidades, usa “Generar mensualidades”.'
            : 'No hay pagos en este estado.'
        }
        rowActions={rowActions}
        onView={setViewing}
        pageSize={25}
      />

      {modal === 'fees' && (
        <TuitionFeesModal
          periods={periods || []}
          onClose={() => {
            setModal(null);
            reload(); // al recargar, las consultas completan las mensualidades con la tarifa nueva
          }}
        />
      )}
      {modal === 'generate' && (
        <GenerateTuitionModal periods={periods || []} onClose={() => setModal(null)} onGenerated={reload} />
      )}
      {modal === 'other' && <RegisterPaymentModal onClose={() => setModal(null)} onCreated={reload} />}

      {viewing && (
        <PaymentDetailModal
          payment={viewing}
          onClose={() => setViewing(null)}
          actions={
            viewing.display_status === 'paid' && canRegister ? (
              <Button
                variant="secondary"
                icon="receipt"
                onClick={async () => {
                  try {
                    const updated = await paymentsApi.regenerateReceipt(viewing.id);
                    toast.success('Comprobante regenerado', 'Se abrió con el diseño y los datos actuales.');
                    await openReceipt(updated.id);
                    reload();
                  } catch (err) {
                    toast.error('No se pudo regenerar', getErrorMessage(err));
                  }
                }}
              >
                Regenerar comprobante
              </Button>
            ) : pendingStatuses.includes(viewing.display_status) && (canRegister || isOwnPayment(viewing)) ? (
              <Button
                icon={canRegister ? 'check' : 'wallet'}
                onClick={() => {
                  setPaying({ payment: viewing, mode: canRegister ? 'register' : 'report' });
                  setViewing(null);
                }}
              >
                {canRegister ? 'Registrar pago' : 'Reportar pago'}
              </Button>
            ) : null
          }
        />
      )}

      {paying && (
        <PaymentFormModal payment={paying.payment} mode={paying.mode} onClose={() => setPaying(null)} onDone={reload} />
      )}
    </div>
  );
}

/** Suma montos de la misma moneda: [{currency,total}] → [{currency,total}]. */
function mergeAmounts(amounts) {
  const acc = {};
  amounts.forEach((a) => {
    acc[a.currency] = (acc[a.currency] || 0) + a.total;
  });
  return Object.entries(acc).map(([currency, total]) => ({ currency, total }));
}

// ---------------------------------------------------------------------------
// Tarifas de mensualidad por año escolar (general + por nivel)
// ---------------------------------------------------------------------------

function TuitionFeesModal({ periods, onClose }) {
  const [schoolPeriodId, setSchoolPeriodId] = useState(periods.find((p) => p.is_active)?.id || periods[0]?.id || '');
  const { data: fees, loading, error, refetch } = useFetch(
    () => (schoolPeriodId ? paymentsApi.listFees(schoolPeriodId) : Promise.resolve([])),
    [schoolPeriodId]
  );
  const period = periods.find((p) => p.id === schoolPeriodId);

  return (
    <Modal title="Tarifas de mensualidad" onClose={onClose} size="lg">
      <p style={{ marginTop: -6 }}>
        Las mensualidades se configuran en <strong>dólares</strong> y cada familia las paga en la moneda que elija (bolívares, pesos, soles…) con la <strong>tasa del día</strong> de esa moneda.
        Se cobra una mensualidad por cada mes del año escolar. Cada nivel usa su tarifa propia o, si no tiene, la <strong>tarifa general</strong>.
        Cambiar una tarifa no modifica mensualidades ya generadas.
      </p>
      <Field label="Año escolar">
        <Select sorted value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)}>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {period && (!period.start_date || !period.end_date) && (
        <Alert variant="warning">Este año escolar no tiene fechas de inicio y fin: sin ellas no se pueden calcular los meses a cobrar.</Alert>
      )}
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        schoolPeriodId && (
          <div className="fee-rows">
            {[null, ...LEVEL_CODES].map((levelCode) => (
              <FeeRow
                key={`${schoolPeriodId}-${levelCode || 'general'}`}
                schoolPeriodId={schoolPeriodId}
                levelCode={levelCode}
                fee={fees.find((f) => (f.level_code || null) === levelCode)}
                fallback={fees.find((f) => !f.level_code)}
                onChanged={refetch}
              />
            ))}
          </div>
        )
      )}
      <div className="form-actions">
        <Button type="button" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Modal>
  );
}

function FeeRow({ schoolPeriodId, levelCode, fee, fallback, onChanged }) {
  const [form, setForm] = useState({
    amount: fee ? String(Number(fee.amount)) : '',
    currency: fee?.currency || fallback?.currency || 'USD',
    dueDay: fee?.due_day || 5,
  });
  const { run, loading, error } = useMutation(paymentsApi.upsertFee);
  const toast = useToast();
  const confirm = useConfirm();
  const title = levelCode ? LEVELS[levelCode].name : 'Tarifa general';

  const save = async () => {
    try {
      await run({ schoolPeriodId, levelCode, amount: Number(form.amount), currency: 'USD', dueDay: Number(form.dueDay) });
      toast.success('Tarifa guardada', title);
      onChanged();
    } catch {
      // error visible en la fila
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `¿Quitar la tarifa de ${title}?`, message: levelCode ? 'Ese nivel usará la tarifa general.' : 'Los niveles sin tarifa propia no generarán mensualidades.', danger: true, confirmLabel: 'Quitar' }))) return;
    try {
      await paymentsApi.deleteFee(fee.id);
      onChanged();
    } catch (err) {
      toast.error('No se pudo quitar', getErrorMessage(err));
    }
  };

  const invalid = !(Number(form.amount) > 0) || !(Number(form.dueDay) >= 1 && Number(form.dueDay) <= 28);

  return (
    <div className={`fee-row ${fee ? 'fee-row--set' : ''}`}>
      <div className="fee-row__title">
        <strong>{title}</strong>
        <span className="cell-person__sub">
          {fee
            ? `${formatMoney(fee.amount, fee.currency)} · vence el día ${fee.due_day}`
            : levelCode
              ? fallback
                ? `Usa la general (${formatMoney(fallback.amount, fallback.currency)})`
                : 'Sin tarifa'
              : 'Sin tarifa general'}
        </span>
      </div>
      <Input type="number" min="0.01" step="0.01" placeholder="Monto" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} aria-label={`Monto ${title}`} />
      <Input value="USD" disabled aria-label={`Moneda ${title}`} title="Las mensualidades se configuran en dólares; se pagan en la moneda elegida con la tasa del día" />
      <Input type="number" min="1" max="28" value={form.dueDay} onChange={(e) => setForm((f) => ({ ...f, dueDay: e.target.value }))} aria-label={`Día límite ${title}`} title="Día límite de pago" />
      <div className="row-actions">
        <Button size="sm" onClick={save} loading={loading} disabled={invalid}>
          {fee ? 'Actualizar' : 'Guardar'}
        </Button>
        {fee && (
          <button type="button" className="row-action row-action--delete" onClick={remove} title="Quitar tarifa" aria-label={`Quitar tarifa ${title}`}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
      {error && <span className="field-error fee-row__error">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generar mensualidades (idempotente: solo crea lo que falta)
// ---------------------------------------------------------------------------

function GenerateTuitionModal({ periods, onClose, onGenerated }) {
  const [schoolPeriodId, setSchoolPeriodId] = useState(periods.find((p) => p.is_active)?.id || periods[0]?.id || '');
  const { run, loading, error } = useMutation(paymentsApi.generateTuition);
  const [result, setResult] = useState(null);

  const handleGenerate = async () => {
    try {
      const r = await run(schoolPeriodId);
      setResult(r);
      onGenerated();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Generar mensualidades" onClose={onClose}>
      <Alert>{error}</Alert>
      {!result ? (
        <>
          <p style={{ marginTop: -6 }}>
            Crea las mensualidades de cada alumno inscrito para todos los meses del año escolar (emisión el día 1, vencimiento
            según la tarifa). <strong>Es seguro repetirlo:</strong> nunca duplica meses, solo completa lo que falta.
          </p>
          <p className="text-sm">
            Normalmente no hace falta: las mensualidades se generan solas al inscribir a un alumno. Úsalo después de cargar o cambiar
            tarifas, o para inscripciones previas.
          </p>
          <Field label="Año escolar">
            <Select sorted value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" icon="sparkles" onClick={handleGenerate} loading={loading} loadingText="Generando…" disabled={!schoolPeriodId}>
              Generar
            </Button>
          </div>
        </>
      ) : (
        <>
          <dl className="detail-list">
            <div className="detail-list__item">
              <dt>Mensualidades creadas</dt>
              <dd>{result.created}</dd>
            </div>
            <div className="detail-list__item">
              <dt>Reactivadas</dt>
              <dd>{result.reactivated}</dd>
            </div>
          </dl>
          {result.skipped.length > 0 ? (
            <div className="detail-section">
              <Alert variant="warning">
                {result.skipped.length} alumno(s) inscrito(s) no recibieron mensualidades. Corrige lo indicado y vuelve a generar.
              </Alert>
              <ul className="assignment-list">
                {result.skipped.map((s) => (
                  <li key={s.enrollment_id}>
                    <strong>{s.student_name}</strong>
                    <span className="text-muted">{s.section}</span>
                    <span className="teacher-stack__missing">{s.reasons.join(' ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Alert variant="success">Todos los alumnos inscritos tienen sus mensualidades al día.</Alert>
          )}
          <div className="form-actions">
            <Button type="button" onClick={onClose}>
              Listo
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Otro cobro (inscripción, uniforme…): cargo manual, sin fecha límite
// ---------------------------------------------------------------------------

function RegisterPaymentModal({ onClose, onCreated }) {
  const { data: students, loading: loadingStudents } = useFetch(() => studentsApi.list({ status: 'active' }), []);
  const [studentId, setStudentId] = useState('');
  const { data: studentDetail, loading: loadingGuardians } = useFetch(
    () => (studentId ? studentsApi.getOne(studentId) : Promise.resolve(null)),
    [studentId]
  );
  const [form, setForm] = useState({ guardianId: '', periodLabel: '', amount: '', currency: 'USD' });
  const { data: otherRates } = useFetch(() => paymentsApi.currentRate(), []);
  const { run, loading, error, fieldErrors } = useMutation(paymentsApi.register);
  const toast = useToast();

  const guardians = useMemo(() => studentDetail?.guardians || [], [studentDetail]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ studentId, guardianId: form.guardianId, periodLabel: form.periodLabel, amount: Number(form.amount), currency: form.currency });
      toast.success('Cobro registrado', form.periodLabel);
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Otro cobro" onClose={onClose}>
      <p style={{ marginTop: -6 }} className="text-sm">
        Para cargos puntuales (inscripción, uniforme, actividades). Las mensualidades se generan automáticamente.
      </p>
      <Alert>{error}</Alert>
      {loadingStudents ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Alumno" error={fieldErrors.studentId} required>
              <Select
                sorted
                value={studentId}
                onChange={(e) => {
                  setStudentId(e.target.value);
                  setForm((f) => ({ ...f, guardianId: '' }));
                }}
                required
              >
                <option value="">Selecciona…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.first_name} {s.last_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Representante responsable" error={fieldErrors.guardianId} required>
              <Select
                sorted
                value={form.guardianId}
                onChange={(e) => setForm((f) => ({ ...f, guardianId: e.target.value }))}
                disabled={!studentId || loadingGuardians}
                required
              >
                <option value="">{studentId ? 'Selecciona…' : 'Elige un alumno primero'}</option>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.first_name} {g.last_name}
                    {g.is_primary ? ' (principal)' : ''}
                  </option>
                ))}
              </Select>
              {studentId && studentDetail && guardians.length === 0 && (
                <span className="form-hint">Este alumno no tiene representantes asociados todavía.</span>
              )}
            </Field>
            <Field label="Concepto" error={fieldErrors.periodLabel} full required>
              <Input value={form.periodLabel} onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} placeholder="Inscripción 2026-2027" maxLength={30} required />
            </Field>
            <Field label="Monto" error={fieldErrors.amount} required>
              <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            </Field>
            <Field label="Moneda del cobro" error={fieldErrors.currency} required hint="Normalmente USD: la familia elige luego en qué moneda paga.">
              <CurrencySelect value={form.currency} onChange={(currency) => setForm((f) => ({ ...f, currency }))} status={otherRates} />
            </Field>
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Registrar cobro
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default PaymentsPage;
