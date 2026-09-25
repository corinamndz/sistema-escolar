import paymentsApi from '../../../api/endpoints/payments.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Table from '../../../components/ui/Table';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';

const STATUS_BADGE = {
  pending: ['Pendiente', 'warning'],
  paid: ['Pagado', 'success'],
  failed: ['Fallido', 'danger'],
  refunded: ['Reembolsado', 'neutral'],
};

/**
 * Vista de padres: un representante ve solo los pagos de sus propios hijos
 * (el backend resuelve esto por `guardians.user_id = req.user.id`, no por un
 * filtro que el frontend pueda manipular).
 */
function MyPaymentsPage() {
  const { data: rows, loading, error } = useFetch(() => paymentsApi.listMine(), []);

  const columns = [
    { key: 'student', header: 'Alumno', render: (p) => `${p.student_first_name} ${p.student_last_name}` },
    { key: 'period_label', header: 'Concepto' },
    { key: 'amount', header: 'Monto', render: (p) => `${p.currency} ${Number(p.amount).toFixed(2)}` },
    { key: 'status', header: 'Estado', render: (p) => { const [label, variant] = STATUS_BADGE[p.status] || ['—', 'neutral']; return <Badge variant={variant}>{label}</Badge>; } },
    { key: 'paid_at', header: 'Fecha de pago', render: (p) => (p.paid_at ? p.paid_at.slice(0, 10) : '—') },
    {
      key: 'receipt',
      header: 'Comprobante',
      render: (p) => (p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noreferrer">Descargar PDF</a> : '—'),
    },
  ];

  return (
    <div>
      <PageHeader title="Mis pagos" subtitle="Historial de pagos de tus hijos" />
      <div className="card">
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={rows} emptyMessage="No hay pagos registrados para tus hijos." />}
      </div>
    </div>
  );
}

export default MyPaymentsPage;
