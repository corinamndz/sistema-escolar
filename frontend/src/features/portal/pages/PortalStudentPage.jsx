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
import AcademicHistory from '../../students/components/AcademicHistory';
import GradesLockedNotice from '../components/GradesLockedNotice';
import ScheduleGrid, { hueOf } from '../../schedules/components/ScheduleGrid';
import { SanctionCard, SeverityTotals } from '../../discipline/components/SanctionParts';
import PortalEvaluations from '../components/PortalEvaluations';
import PortalEvaluationPlan from '../components/PortalEvaluationPlan';
import PortalClubs from '../components/PortalClubs';
import PortalRecognitions from '../components/PortalRecognitions';
import PortalCarryovers from '../../carryovers/components/PortalCarryovers';
import FormPdfButton from '../../enrollment-forms/components/FormPdfButton';
import { usePortalViews } from '../../../lib/portalViews';

// `view`: la clave en Configuración → Vistas del representante (Información siempre se muestra).
const TABS = [
  { key: 'grades', label: 'Calificaciones', view: 'grades' },
  { key: 'plan', label: 'Plan de evaluación', view: 'evaluation_plan' },
  { key: 'schedule', label: 'Horario', view: 'schedule' },
  { key: 'evaluations', label: 'Evaluaciones', view: 'evaluations' },
  { key: 'history', label: 'Historial académico', view: 'history' },
  { key: 'recognitions', label: 'Reconocimientos', view: 'recognitions' },
  { key: 'discipline', label: 'Convivencia', view: 'discipline' },
  { key: 'clubs', label: 'Clubes', view: 'clubs' },
  { key: 'info', label: 'Información' },
];

/**
 * Detalle de un alumno en el portal del representante. Los datos salen de
 * /portal/me (solo trae a SUS representados), así que un id ajeno no muestra nada.
 */
function PortalStudentPage() {
  const { studentId } = useParams();
  const [params, setParams] = useSearchParams();
  const isOn = usePortalViews();
  const tabs = TABS.filter((t) => !t.view || isOn(t.view));
  // Pestaña pedida (p. ej. desde un aviso) si está activa; si no, la primera visible.
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : tabs[0].key;
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

      {/* Con cuotas vencidas los detalles (calificaciones) están bloqueados: solo el aviso. */}
      {student.grades_locked ? (
        <GradesLockedNotice overdueCount={student.payments?.overdue_count} />
      ) : (
        <Tabs tabs={tabs} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      )}

      {!student.grades_locked && tab === 'grades' && (
        <>
          {/* En paralelo a su año actual: solo aparece si tiene materias pendientes. */}
          <PortalCarryovers studentId={studentId} />
          <StudentGrades studentId={studentId} />
        </>
      )}
      {!student.grades_locked && tab === 'plan' && <PortalEvaluationPlan studentId={studentId} />}
      {!student.grades_locked && tab === 'schedule' && <PortalSchedule studentId={studentId} />}
      {!student.grades_locked && tab === 'evaluations' && <PortalEvaluations studentId={studentId} />}
      {!student.grades_locked && tab === 'history' && <PortalHistory studentId={studentId} />}
      {!student.grades_locked && tab === 'discipline' && <PortalSanctions studentId={studentId} />}
      {!student.grades_locked && tab === 'clubs' && <PortalClubs studentId={studentId} />}
      {/* Los logros se celebran aunque haya cuotas vencidas: el enlace del aviso siempre muestra la tarjeta. */}
      {tab === 'recognitions' && <PortalRecognitions studentId={studentId} />}

      {!student.grades_locked && tab === 'info' && (
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

/** Historial académico (años anteriores y el actual) para el representante. */
function PortalHistory({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentHistory(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  // Cada año con el diseño de su nivel y su año, solo si el colegio lo publicó.
  const certificates = data.years.filter((y) => (data.certificate_enrollment_ids || []).includes(y.enrollment_id));
  return (
    <Card
      title="Historial académico"
      subtitle="Grados cursados en cada año escolar, resultado y notas finales"
      actions={
        certificates.length > 0 && (
          <span className="cert-portal">
            {certificates.map((y) => (
              <FormPdfButton key={y.enrollment_id} load={() => portalApi.getStudentCertificate(studentId, y.enrollment_id)} fileName={`certificado-${y.school_period.name}.pdf`} label={`Certificado ${y.school_period.name}`} />
            ))}
          </span>
        )
      }
    >
      <AcademicHistory data={data} />
    </Card>
  );
}

/** Historial disciplinario del alumno (solo lectura): tipo de falta, motivo, medida, fecha y período. */
function PortalSanctions({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentSanctions(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Card title="Historial disciplinario" subtitle="Faltas y llamados de atención registrados por el colegio">
      <SeverityTotals totals={data.totals} />
      {data.items.length === 0 ? (
        <p className="text-muted">Sin sanciones registradas. ¡Sigue así!</p>
      ) : (
        <div className="sanction-list">
          {data.items.map((s) => (
            <SanctionCard key={s.id} sanction={s} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Horario semanal de la sección del alumno (solo lectura). */
function PortalSchedule({ studentId }) {
  const { data, loading, error } = useFetch(() => portalApi.getStudentSchedule(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <Card
      title="Horario de clases"
      subtitle={data.section ? `${data.section.grade_name} · Sección ${data.section.name} · ${data.section.school_period_name}` : undefined}
    >
      {!data.section ? (
        <p className="text-muted">El alumno no tiene una inscripción activa.</p>
      ) : !data.slots.length || !data.entries.length ? (
        <p className="text-muted">El colegio aún no ha publicado el horario de esta sección.</p>
      ) : (
        <ScheduleGrid days={data.days} slots={data.slots} entries={data.entries} colorOf={(e) => hueOf(e.subject_id)} />
      )}
    </Card>
  );
}

export default PortalStudentPage;
