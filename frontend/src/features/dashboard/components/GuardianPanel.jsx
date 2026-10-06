import { useState } from 'react';
import GradesLockedNotice, { GRADES_LOCKED_MESSAGE } from '../../portal/components/GradesLockedNotice';
import { Link } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import StatCard from '../../../components/ui/StatCard';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { LevelBadge } from '../../academics/levels';
import { formatAmounts, formatDate, formatMoney } from '../../payments/paymentStatus';

const STUDENT_STATUS = {
  active: ['Activo', 'success'],
  inactive: ['Inactivo', 'neutral'],
  graduated: ['Egresado', 'primary'],
  withdrawn: ['Retirado', 'danger'],
};


/** `refCurrency`: moneda en que el backend totalizó lo pendiente (portal.ref_currency). */
function StudentCard({ student, refCurrency }) {
  const [statusLabel, statusVariant] = STUDENT_STATUS[student.status] || ['—', 'neutral'];
  const { payments } = student;
  // Con cuotas vencidas, las calificaciones están bloqueadas (el backend también lo exige).
  const locked = Boolean(student.grades_locked);
  const [showLock, setShowLock] = useState(false);
  const initials = `${student.first_name[0] || ''}${student.last_name[0] || ''}`.toUpperCase();

  return (
    <article className="student-card">
      <header className="student-card__head">
        <span className="avatar">{initials}</span>
        <div className="student-card__who">
          <h3 className="student-card__name">
            {locked ? (
              `${student.first_name} ${student.last_name}`
            ) : (
              <Link to={`/portal/students/${student.id}`}>
                {student.first_name} {student.last_name}
              </Link>
            )}
          </h3>
          <div className="cell-person__sub">
            {[student.relationship, student.national_id ? `C.I. ${student.national_id}` : null].filter(Boolean).join(' · ') ||
              'Sin documento registrado'}
          </div>
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </header>

      <div className="student-card__block">
        <span className="student-card__label">
          <Icon name="school" size={15} /> Información académica
        </span>
        {student.section_id ? (
          <>
            <div className="student-card__value">
              {student.grade_name} · Sección {student.section_name}
            </div>
            <div className="student-level">
              <LevelBadge code={student.level_code} short={false} />
              <span className="cell-person__sub">Año escolar {student.school_period_name}</span>
            </div>
          </>
        ) : (
          <div className="student-card__value text-muted">Sin inscripción activa en este momento</div>
        )}
      </div>

      <div
        className={`student-card__block student-card__pay ${
          payments.overdue_count ? 'is-overdue' : payments.pending_count ? 'is-pending' : 'is-ok'
        }`}
      >
        <span className="student-card__label">
          <Icon name="wallet" size={15} /> Pagos
        </span>
        {payments.pending_count ? (
          <div className="student-card__value">
            {payments.overdue_count
              ? `${payments.overdue_count} vencido${payments.overdue_count === 1 ? '' : 's'}`
              : `${payments.pending_count} pendiente${payments.pending_count === 1 ? '' : 's'}`}{' '}
            · {formatAmounts(payments.pending_amounts)}
            {payments.pending_ref !== null && payments.pending_ref !== undefined && refCurrency && refCurrency !== 'USD' && (
              <span className="cell-person__sub"> (≈ {formatMoney(payments.pending_ref, refCurrency)})</span>
            )}
          </div>
        ) : (
          <div className="student-card__value">
            <Icon name="checkCircle" size={15} /> {payments.paid_count ? 'Al día' : 'Sin pagos por ahora'}
          </div>
        )}
        {payments.reported_count > 0 && (
          <div className="cell-person__sub">{payments.reported_count} reportado(s), en revisión</div>
        )}
        {payments.next_due && (
          <div className="cell-person__sub">
            Próxima: {payments.next_due.period_label} · {formatMoney(payments.next_due.amount, payments.next_due.currency)} · vence el{' '}
            {formatDate(payments.next_due.due_date, false)}
          </div>
        )}
        {payments.last_paid && (
          <div className="cell-person__sub">
            Último pago: {payments.last_paid.period_label} · {formatDate(payments.last_paid.paid_at)}
          </div>
        )}
      </div>
      <div className="student-card__actions">
        {locked ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm btn--locked"
            aria-disabled="true"
            aria-expanded={showLock}
            aria-controls={`lock-${student.id}`}
            title={GRADES_LOCKED_MESSAGE}
            onClick={() => setShowLock((v) => !v)}
          >
            <Icon name="lock" size={15} /> Detalles del alumno
          </button>
        ) : (
          <Link to={`/portal/students/${student.id}`} className="btn btn--secondary btn--sm">
            <Icon name="clipboard" size={15} /> Detalles del alumno
          </Link>
        )}
      </div>
      {locked && showLock && <GradesLockedNotice id={`lock-${student.id}`} overdueCount={payments.overdue_count} compact />}
    </article>
  );
}

/**
 * Aviso cuando el colegio aún no pudo generar las mensualidades de algún
 * alumno (normalmente, falta configurar la tarifa). Se redacta para el padre:
 * no es algo que él pueda resolver, pero debe saber que su saldo no está completo.
 */
export function BillingNotice({ issues }) {
  const names = issues.map((i) => i.student_name).join(', ');
  return (
    <Alert variant="warning">
      <strong>Tu estado de cuenta aún no está completo.</strong> El colegio todavía no ha emitido las mensualidades de {names}.
      Por eso pueden no aparecer pagos pendientes. Si tienes dudas, comunícate con la administración.
    </Alert>
  );
}

/**
 * Panel principal del representante (portal de padres): resumen y una
 * tarjeta por alumno con su información académica y estado de pagos.
 */
function GuardianPanel() {
  const { data, loading, error } = useFetch(() => portalApi.getMine(), []);

  if (loading) return <Spinner label="Cargando tus alumnos…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data?.guardian) return null;

  const { students, totals, billing_issues: billingIssues = [] } = data;
  // Si hay alumnos sin mensualidades generadas, "0 pendientes" no significa "al día".
  const incomplete = billingIssues.length > 0;

  return (
    <>
      {incomplete && <BillingNotice issues={billingIssues} />}

      <div className="grid grid--3" style={{ marginBottom: 24 }}>
        <StatCard label="Alumnos a cargo" value={totals.students} icon="graduation" tone="primary" hint="Vinculados a tu cuenta" />
        <StatCard
          label="Pagos pendientes"
          value={totals.pending_count}
          icon="receipt"
          tone={totals.overdue_count ? 'danger' : totals.pending_count || incomplete ? 'warning' : 'success'}
          to="/payments/mine"
          linkLabel="Pagar / reportar"
          hint={
            totals.overdue_count
              ? `${totals.overdue_count} vencido(s)`
              : totals.pending_count
                ? 'Por pagar'
                : incomplete
                  ? 'Estado de cuenta incompleto'
                  : 'Estás al día'
          }
        />
        <StatCard
          label="Monto pendiente"
          value={totals.pending_amounts.length ? formatAmounts(totals.pending_amounts) : formatMoney(0, 'USD')}
          icon="wallet"
          tone={totals.pending_count ? 'warning' : 'success'}
          hint={
            totals.pending_count && totals.pending_ref !== null && data.ref_currency !== 'USD'
              ? `≈ ${formatMoney(totals.pending_ref, data.ref_currency)} (tasa del día)`
              : 'Suma de pagos pendientes'
          }
        />
      </div>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              Mis alumnos <span className="data-table__count">{students.length}</span>
            </h3>
            <p className="card__subtitle">Información académica y estado de pagos de cada uno</p>
          </div>
          <Link to="/payments/mine" className="btn btn--secondary btn--sm">
            <Icon name="receipt" size={15} /> Ver mis pagos
          </Link>
        </div>

        {students.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="graduation" size={24} />
            </div>
            <div className="empty-state__title">Aún no tienes alumnos vinculados</div>
            <div className="text-sm">Comunícate con la administración del colegio para asociar a tus representados a tu cuenta.</div>
          </div>
        ) : (
          <div className="student-cards">
            {students.map((s) => (
              <StudentCard key={s.id} student={s} refCurrency={data.ref_currency} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default GuardianPanel;
