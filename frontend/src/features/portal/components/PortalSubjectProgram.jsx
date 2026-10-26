import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { CATEGORY_LABELS } from '../../programmatic-content/categories';
import { INSTRUMENT_LABELS } from '../../evaluation-plans/instruments';

const pct = (n) => `${Number(n).toLocaleString('es', { maximumFractionDigits: 2 })} %`;
const day = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** Una evaluación: título, tipo, estrategia/instrumento, porcentaje y fecha en la sección del alumno. */
function Evaluation({ e, showTopic }) {
  const when = day(e.date);
  return (
    <li className="pp-eval">
      <div className="pp-eval__main">
        <strong>{e.title}</strong>
        <span className="pp-eval__meta">
          <span className="chip">{CATEGORY_LABELS[e.category] || e.category}</span>
          {e.strategy && <span>{e.strategy}</span>}
          {e.instrument && <span className="text-muted">· {INSTRUMENT_LABELS[e.instrument] || e.instrument}</span>}
          {showTopic && e.topic && <span className="text-muted">· {e.topic}</span>}
        </span>
      </div>
      <div className="pp-eval__side">
        <span className="pp-eval__weight">{pct(e.weight_percent)}</span>
        <span className={`pp-eval__date ${when ? '' : 'is-empty'}`}>
          <Icon name="calendar" size={12} /> {when || 'Sin fecha'}
        </span>
        <span className="pp-eval__term">{e.term_name}</span>
      </div>
    </li>
  );
}

/**
 * Portal del representante → materia → "Contenido y evaluaciones": el
 * contenido programático (unidades y temas) con las evaluaciones publicadas
 * de cada tema en la sección del alumno. Con la revisión académica activa,
 * solo lo aprobado por coordinación.
 */
function PortalSubjectProgram({ studentId, subjectId, schoolPeriodId }) {
  const { data, loading, error } = useFetch(
    () => portalApi.getStudentSubjectProgram(studentId, subjectId, schoolPeriodId ? { schoolPeriodId } : undefined),
    [studentId, subjectId, schoolPeriodId]
  );
  const [closed, setClosed] = useState(() => new Set());

  if (loading) return <Spinner label="Cargando contenido…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const evaluationCount = data.units.reduce((n, u) => n + u.items.reduce((m, i) => m + i.evaluations.length, 0), 0) + data.other_evaluations.length;
  const toggle = (unit) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });

  return (
    <div className="pp">
      <div className="pp-summary">
        <div>
          <span className="pp-summary__label">Sección</span>
          <strong>
            {data.grade_name} {data.section_name}
          </strong>
          <span className="text-sm text-muted">Año escolar {data.school_period.name}</span>
        </div>
        <div>
          <span className="pp-summary__label">Evaluaciones publicadas</span>
          <strong>{evaluationCount}</strong>
          <span className="text-sm text-muted">{data.total_weight_by_term.map((t) => `${t.term_name}: ${pct(t.total)}`).join(' · ') || 'Aún no hay planes publicados'}</span>
        </div>
      </div>

      {data.content_status === 'pending' && (
        <Alert variant="info">El contenido programático de {data.subject.name} se publicará cuando coordinación lo apruebe.</Alert>
      )}
      {data.content_status === 'empty' && <Alert variant="info">El colegio aún no ha cargado el contenido programático de {data.subject.name}.</Alert>}

      {data.units.map((u) => {
        const open = !closed.has(u.unit);
        const evals = u.items.reduce((n, i) => n + i.evaluations.length, 0);
        return (
          <section key={u.unit} className="pp-unit">
            <button type="button" className="pp-unit__head" onClick={() => toggle(u.unit)} aria-expanded={open}>
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
              <span className="pp-unit__title">{u.unit}</span>
              <span className="text-sm text-muted">
                {u.items.length} tema{u.items.length === 1 ? '' : 's'} · {evals} evaluaci{evals === 1 ? 'ón' : 'ones'}
              </span>
            </button>
            {open && (
              <ol className="pp-topics">
                {u.items.map((t) => (
                  <li key={t.id} className="pp-topic">
                    <div className="pp-topic__head">
                      <strong>{t.topic}</strong>
                      {t.description && <p>{t.description}</p>}
                    </div>
                    {t.evaluations.length ? (
                      <ul className="pp-evals">
                        {t.evaluations.map((e) => (
                          <Evaluation key={e.id} e={e} />
                        ))}
                      </ul>
                    ) : (
                      <span className="pp-topic__none">Sin evaluación publicada</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}

      {data.other_evaluations.length > 0 && (
        <section className="pp-unit">
          <div className="pp-unit__head is-static">
            <Icon name="clipboard" size={16} />
            <span className="pp-unit__title">{data.content_status === 'published' ? 'Otras evaluaciones' : 'Evaluaciones publicadas'}</span>
          </div>
          <ul className="pp-evals pp-evals--flat">
            {data.other_evaluations.map((e) => (
              <Evaluation key={e.id} e={e} showTopic />
            ))}
          </ul>
        </section>
      )}

      {!data.units.length && !data.other_evaluations.length && data.content_status !== 'pending' && data.content_status !== 'empty' && (
        <p className="text-sm text-muted">Todavía no hay evaluaciones publicadas para esta materia.</p>
      )}
    </div>
  );
}

export default PortalSubjectProgram;
