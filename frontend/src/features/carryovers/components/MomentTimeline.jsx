import Icon from '../../../components/ui/Icon';

export const fmtGrade = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

/** Estado de la materia pendiente. */
export const CARRYOVER_STATUS = {
  pending: { label: 'Sin plan', variant: 'neutral' },
  in_progress: { label: 'En recuperación', variant: 'info' },
  passed: { label: 'Aprobada', variant: 'success' },
  failed: { label: 'No aprobada', variant: 'danger' },
  suspended: { label: 'En suspenso', variant: 'warning' },
  cancelled: { label: 'Anulada', variant: 'neutral' },
};

const MOMENT = {
  locked: { label: 'Por habilitar', icon: 'lock' },
  open: { label: 'Habilitado', icon: 'clock' },
  passed: { label: 'Aprobado', icon: 'check' },
  failed: { label: 'Reprobado', icon: 'x' },
  not_needed: { label: 'No fue necesario', icon: 'arrowRight' },
};

/** Avance compacto: un punto por momento, para las tablas. */
export function MomentDots({ moments }) {
  if (!moments.length) return <span className="text-muted text-sm">Sin momentos</span>;
  return (
    <span className="cm-dots" title={moments.map((m) => `${m.name}: ${MOMENT[m.status].label}${m.grade !== null ? ` (${fmtGrade(m.grade)})` : ''}`).join('\n')}>
      {moments.map((m) => (
        <span key={m.id} className={`cm-dot cm-dot--${m.status}`} aria-hidden="true" />
      ))}
      <span className="text-sm text-muted">{moments.filter((m) => m.grade !== null).length}/{moments.length}</span>
    </span>
  );
}

/** Los momentos en orden, con su estado y nota. `renderExtra(m)`: lo que el profesor puede hacer en cada uno. */
function MomentTimeline({ moments, renderExtra }) {
  return (
    <ol className="cm-line">
      {moments.map((m) => {
        const s = MOMENT[m.status];
        return (
          <li key={m.id} className={`cm-step cm-step--${m.status}`}>
            <span className="cm-step__mark">
              <Icon name={s.icon} size={13} />
            </span>
            <div className="cm-step__body">
              <div className="cm-step__head">
                <strong>{m.name}</strong>
                <span className="cm-step__state">
                  {m.grade !== null && m.grade !== undefined ? <b>{fmtGrade(m.grade)}</b> : null} {s.label}
                </span>
              </div>
              {(m.scheduled_on || m.description) && (
                <p className="cm-step__text">
                  {m.scheduled_on && <span>{fmtDate(m.scheduled_on)}</span>}
                  {m.scheduled_on && m.description && ' · '}
                  {m.description}
                </p>
              )}
              {m.notes && <p className="cm-step__text">Observación: {m.notes}</p>}
              {renderExtra?.(m)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default MomentTimeline;
