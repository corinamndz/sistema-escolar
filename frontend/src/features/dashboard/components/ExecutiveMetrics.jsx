import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';
import { formatAmounts } from '../../payments/paymentStatus';

const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);
const fmtPct = (n) => `${n.toLocaleString('es', { maximumFractionDigits: 1 })} %`;
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('es', { month: 'long', year: 'numeric' });
const day = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });

/** Tono de la morosidad: verde sin atrasos, ámbar hasta 10 %, rojo desde ahí. */
const toneOf = (rate) => (rate === null || rate === 0 ? 'success' : rate < 10 ? 'warning' : 'danger');

/**
 * Inscripción del año escolar elegido: alumnos con planilla APROBADA frente al
 * total (los cupos de las secciones o, sin cupos, los alumnos activos). Debajo,
 * cómo están los alumnos activos: aprobados, en revisión y sin planilla.
 */
function EnrollmentCard({ data }) {
  const share = pct(data.approved, data.total);
  const byCapacity = data.total_basis === 'capacity';
  return (
    <section className="card exec-card">
      <header className="exec-card__head">
        <span className="exec-card__icon exec-card__icon--primary">
          <Icon name="graduation" size={18} />
        </span>
        <div>
          <h3>Alumnos inscritos</h3>
          <p>Año escolar {data.school_period.name} · con planilla aprobada</p>
        </div>
      </header>
      <p className="exec-card__value">
        {data.approved.toLocaleString('es')}
        <span>
          {' '}
          / {data.total.toLocaleString('es')} {byCapacity ? 'cupos' : 'alumnos'}
        </span>
      </p>
      <p className="exec-card__caption">
        {data.forms === 0
          ? `Aún no hay una planilla de inscripción para ${data.school_period.name}.`
          : `De ${n(data.active, 'alumno activo', 'alumnos activos')}: ${data.approved} con planilla aprobada · ${data.in_review} en revisión · ${data.without} sin planilla aprobada`}
      </p>
      <div className="exec-card__bar" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la inscripción">
        <span style={{ width: `${Math.min(100, share)}%` }} />
      </div>
      <div className="exec-card__foot">
        <span title={byCapacity ? 'Alumnos con planilla aprobada sobre la suma de cupos de las secciones del año' : 'Las secciones no tienen cupo definido: el total son los alumnos activos'}>
          <strong>{fmtPct(share)}</strong> de avance de la inscripción
        </span>
        <Link to="/enrollment-submissions" className="exec-card__link">
          Ver planillas <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </section>
  );
}

/** Morosidad de las mensualidades del mes en curso, con lo que falta cobrar. */
function DelinquencyCard({ data }) {
  const tone = toneOf(data.rate);
  return (
    <section className={`card exec-card exec-card--${tone}`}>
      <header className="exec-card__head">
        <span className={`exec-card__icon exec-card__icon--${tone}`}>
          <Icon name={tone === 'success' ? 'checkCircle' : 'alertTriangle'} size={18} />
        </span>
        <div>
          <h3>Morosidad del mes</h3>
          <p>Mensualidades de {monthName(data.month)}</p>
        </div>
      </header>
      {data.billed === 0 ? (
        <p className="exec-card__caption">Aún no hay mensualidades emitidas para este mes.</p>
      ) : (
        <>
          <p className={`exec-card__value exec-card__value--${tone}`}>
            {fmtPct(data.rate)}
            <span> de morosidad</span>
          </p>
          <p className="exec-card__caption">
            {data.overdue} de {n(data.billed, 'mensualidad', 'mensualidades')} {data.overdue === 1 ? 'vencida' : 'vencidas'} sin pagar
            {data.overdue === 0 && data.next_due ? ` · las pendientes vencen desde el ${day(data.next_due)}` : ''}
          </p>
          <div className="exec-card__bar exec-card__bar--split" aria-hidden="true">
            <span className="is-paid" style={{ width: `${pct(data.paid, data.billed)}%` }} />
            <span className="is-reported" style={{ width: `${pct(data.reported, data.billed)}%` }} />
            <span className="is-pending" style={{ width: `${pct(data.pending, data.billed)}%` }} />
            <span className="is-overdue" style={{ width: `${pct(data.overdue, data.billed)}%` }} />
          </div>
          <ul className="exec-card__legend">
            <li className="is-paid">{n(data.paid, 'pagada', 'pagadas')}</li>
            {data.reported > 0 && <li className="is-reported">{data.reported} en revisión</li>}
            <li className="is-pending">{data.pending} por vencer</li>
            <li className="is-overdue">{n(data.overdue, 'vencida', 'vencidas')}</li>
          </ul>
          <div className="exec-card__foot">
            <span>
              Por cobrar del mes: <strong>{formatAmounts(data.due_amounts) || '—'}</strong>
              {data.overdue_amounts.length > 0 && <> · vencido {formatAmounts(data.overdue_amounts)}</>}
            </span>
            <Link to={`/payments?estado=overdue${data.school_period_id ? `&anio=${data.school_period_id}` : ''}`} className="exec-card__link">
              Ir a cobranzas <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Tarjetas ejecutivas del inicio (administración): inscritos vs. esperados del
 * año elegido y morosidad del mes en curso. Cada una solo con su permiso: el
 * servidor la omite si el usuario no puede leer Alumnos o Pagos.
 */
function ExecutiveMetrics({ summary }) {
  const enrollment = summary?.enrollment_progress;
  const delinquency = summary?.delinquency;
  if (!enrollment && !delinquency) return null;
  return (
    <div className={`grid ${enrollment && delinquency ? 'grid--2' : 'grid--1'} exec-metrics`}>
      {enrollment && <EnrollmentCard data={enrollment} />}
      {delinquency && <DelinquencyCard data={delinquency} />}
    </div>
  );
}

export default ExecutiveMetrics;
