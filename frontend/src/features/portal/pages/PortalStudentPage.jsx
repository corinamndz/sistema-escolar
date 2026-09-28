import { Link, useParams, useSearchParams } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Tabs from '../../../components/ui/Tabs';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { LevelBadge } from '../../academics/levels';
import { formatAmounts, formatDate, formatMoney } from '../../payments/paymentStatus';
import StudentGrades from '../components/StudentGrades';

const TABS = [
  { key: 'grades', label: 'Calificaciones' },
  { key: 'info', label: 'Información' },
];

/**
 * Detalle de un alumno en el portal del representante. Los datos salen de
 * /portal/me (solo trae a SUS representados), así que un id ajeno no muestra nada.
 */
function PortalStudentPage() {
  const { studentId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'grades';
  const { data, loading, error } = useFetch(() => portalApi.getMine(), []);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;

  const student = data?.students?.find((s) => s.id === studentId);
  if (!student) {
    return (
      <div className="not-found">
        <h2>Alumno no encontrado</h2>
        <p>Este alumno no está vinculado a tu cuenta.</p>
        <Link to="/" className="btn btn--primary">
          <Icon name="arrowLeft" size={17} /> Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${student.first_name} ${student.last_name}`}
        subtitle={
          <span className="page-header__meta">
            {student.section_id ? (
              <>
                <LevelBadge code={student.level_code} />
                {student.grade_name} · Sección {student.section_name} · {student.school_period_name}
              </>
            ) : (
              'Sin inscripción activa'
            )}
          </span>
        }
        actions={
          <Link to="/" className="btn btn--secondary">
            <Icon name="arrowLeft" size={16} /> Volver
          </Link>
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />

      {tab === 'grades' && <StudentGrades studentId={studentId} />}

      {tab === 'info' && (
        <div className="grid grid--2">
          <Card title="Datos del alumno">
            <dl className="detail-list">
              <div className="detail-list__item">
                <dt>Cédula / documento</dt>
                <dd>{student.national_id || '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Parentesco</dt>
                <dd>{student.relationship || '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Grado y sección</dt>
                <dd>{student.section_id ? `${student.grade_name} · ${student.section_name}` : '—'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Nivel</dt>
                <dd>{student.level_name || '—'}</dd>
              </div>
            </dl>
          </Card>
          <Card title="Pagos" actions={<Link to="/payments/mine" className="btn btn--secondary btn--sm">Ver mis pagos</Link>}>
            <dl className="detail-list">
              <div className="detail-list__item">
                <dt>Por pagar</dt>
                <dd>{student.payments.pending_count ? formatAmounts(student.payments.pending_amounts) : 'Al día'}</dd>
              </div>
              <div className="detail-list__item">
                <dt>Vencidos</dt>
                <dd>{student.payments.overdue_count}</dd>
              </div>
              <div className="detail-list__item detail-list__item--full">
                <dt>Próxima mensualidad</dt>
                <dd>
                  {student.payments.next_due
                    ? `${student.payments.next_due.period_label} · ${formatMoney(student.payments.next_due.amount, student.payments.next_due.currency)} · vence el ${formatDate(student.payments.next_due.due_date)}`
                    : '—'}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}
    </div>
  );
}

export default PortalStudentPage;
