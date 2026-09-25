import { useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

const STATUS_BADGE = {
  pending: ['Pendiente', 'warning'],
  paid: ['Pagado', 'success'],
  failed: ['Fallido', 'danger'],
  refunded: ['Reembolsado', 'neutral'],
};

function PaymentsPage() {
  const [status, setStatus] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(() => paymentsApi.list(status ? { status } : undefined), [status]);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState(null);
  const { run: markPaidRun, loading: marking, error: markError } = useMutation(paymentsApi.markAsPaid);

  const confirm = useConfirm();

  const handleMarkAsPaid = async (id) => {
    const ok = await confirm({
      title: '¿Confirmar que este pago fue recibido?',
      message: 'Se generará el comprobante y se enviará por correo al representante.',
      icon: 'checkCircle',
      confirmLabel: 'Sí, confirmar pago',
    });
    if (!ok) return;
    setNotice(null);
    try {
      const result = await markPaidRun(id);
      setNotice(
        result.emailSent
          ? 'Pago registrado y comprobante enviado por correo.'
          : `Pago registrado, pero el correo no pudo enviarse${result.emailError ? `: ${result.emailError}` : '.'}`
      );
      refetch();
    } catch {
      // error visible arriba
    }
  };

  const columns = [
    { key: 'student', header: 'Alumno', render: (p) => `${p.student_first_name} ${p.student_last_name}` },
    { key: 'guardian', header: 'Representante', render: (p) => `${p.guardian_first_name} ${p.guardian_last_name}` },
    { key: 'period_label', header: 'Concepto' },
    { key: 'amount', header: 'Monto', render: (p) => `${p.currency} ${Number(p.amount).toFixed(2)}` },
    { key: 'status', header: 'Estado', render: (p) => { const [label, variant] = STATUS_BADGE[p.status] || ['—', 'neutral']; return <Badge variant={variant}>{label}</Badge>; } },
    {
      key: 'receipt',
      header: 'Comprobante',
      render: (p) => (p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noreferrer">Ver PDF</a> : '—'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) =>
        p.status === 'pending' && (
          <RequirePermission module="payments" action="approve_payment">
            <Button size="sm" onClick={() => handleMarkAsPaid(p.id)} loading={marking}>
              Marcar como pagado
            </Button>
          </RequirePermission>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pagos"
        subtitle="Mensualidades y comprobantes"
        actions={
          <RequirePermission module="payments" action="create">
            <Button onClick={() => setShowCreate(true)}>+ Registrar pago</Button>
          </RequirePermission>
        }
      />

      <div className="card">
        <div style={{ marginBottom: 16, maxWidth: 220 }}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="failed">Fallido</option>
            <option value="refunded">Reembolsado</option>
          </Select>
        </div>

        <Alert variant="success">{notice}</Alert>
        <Alert>{error || markError}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} emptyMessage="Aún no hay pagos registrados." />}
      </div>

      {showCreate && <RegisterPaymentModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
    </div>
  );
}

function RegisterPaymentModal({ onClose, onCreated }) {
  const { data: students, loading: loadingStudents } = useFetch(() => studentsApi.list({ status: 'active' }), []);
  const [studentId, setStudentId] = useState('');
  const { data: studentDetail, loading: loadingGuardians } = useFetch(
    () => (studentId ? studentsApi.getOne(studentId) : Promise.resolve(null)),
    [studentId]
  );

  const [form, setForm] = useState({ guardianId: '', periodLabel: '', amount: '', currency: 'USD' });
  const { run, loading, error, fieldErrors } = useMutation(paymentsApi.register);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ studentId, guardianId: form.guardianId, periodLabel: form.periodLabel, amount: Number(form.amount), currency: form.currency });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Registrar pago" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingStudents ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Alumno" error={fieldErrors.studentId} full>
              <Select value={studentId} onChange={(e) => { setStudentId(e.target.value); setForm((f) => ({ ...f, guardianId: '' })); }} required>
                <option value="">Selecciona…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Representante que paga" error={fieldErrors.guardianId} full>
              <Select
                value={form.guardianId}
                onChange={(e) => setForm((f) => ({ ...f, guardianId: e.target.value }))}
                disabled={!studentId || loadingGuardians}
                required
              >
                <option value="">{studentId ? 'Selecciona…' : 'Elige un alumno primero'}</option>
                {studentDetail?.guardians.map((g) => (
                  <option key={g.id} value={g.id}>{g.first_name} {g.last_name}{g.is_primary ? ' (principal)' : ''}</option>
                ))}
              </Select>
              {studentId && studentDetail && studentDetail.guardians.length === 0 && (
                <span className="text-muted text-sm">Este alumno no tiene representantes asociados todavía.</span>
              )}
            </Field>

            <Field label="Concepto" error={fieldErrors.periodLabel} full>
              <Input
                value={form.periodLabel}
                onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))}
                placeholder="Mensualidad Octubre 2026"
                required
              />
            </Field>

            <Field label="Monto" error={fieldErrors.amount}>
              <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
            </Field>

            <Field label="Moneda" error={fieldErrors.currency}>
              <Input value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} required />
            </Field>
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Registrar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default PaymentsPage;
