import { useCallback, useEffect, useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { formatDate } from '../../payments/paymentStatus';

const CATEGORY_LABELS = { formative: 'Formativa', exam: 'Examen', project: 'Proyecto', homework: 'Tarea', other: 'Otra' };

/** 16.3 → "16,3" */
const fmt = (n, digits = 1) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** Clase de color según la nota: aprobado / reprobado / sin datos. */
const gradeTone = (value, passing) => (value === null || value === undefined ? 'grade--none' : value >= passing ? 'grade--pass' : 'grade--fail');

const PLAN_STATUS = {
  final: { label: 'Definitiva', variant: 'success' },
  in_progress: { label: 'En curso', variant: 'info' },
  no_grades: { label: 'Sin notas aún', variant: 'neutral' },
  no_activities: { label: 'Sin actividades', variant: 'neutral' },
};

/**
 * Calificaciones acumuladas de un alumno (portal del representante):
 * por materia y lapso, con cada actividad del plan de evaluación, su nota y
 * el acumulado actual. Los cálculos vienen del backend (grades.service.js).
 */
/**
 * Materias colapsadas del alumno (por defecto todas expandidas). Se recuerda
 * por alumno en este navegador; si el almacenamiento no está disponible
 * (modo privado), simplemente no se recuerda.
 */
function useCollapsedSubjects(studentId) {
  const storageKey = `ui.grades.collapsed.${studentId}`;
  const read = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
    } catch {
      return new Set();
    }
  };
  const [collapsed, setCollapsed] = useState(read);

  // Al cambiar de alumno, cargar su propia preferencia.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setCollapsed(read()), [storageKey]);

  const persist = useCallback(
    (next) => {
      setCollapsed(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // sin almacenamiento: solo dura mientras la página esté abierta
      }
    },
    [storageKey]
  );

  const toggle = useCallback(
    (key) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
    },
    [collapsed, persist]
  );

  return { collapsed, toggle, setAll: persist };
}

function StudentGrades({ studentId }) {
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const [termId, setTermId] = useState('');
  const { data, loading, error } = useFetch(
    () => portalApi.getStudentGrades(studentId, schoolPeriodId ? { schoolPeriodId } : undefined),
    [studentId, schoolPeriodId]
  );
  const { collapsed, toggle, setAll } = useCollapsedSubjects(studentId);

  if (loading) return <Spinner label="Cargando calificaciones…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { scale, passing_grade: passing, periods, terms, subjects } = data;

  if (periods.length === 0) {
    return <EmptyGrades title="Sin inscripciones" text="El alumno todavía no está inscrito en ninguna sección." />;
  }

  const visible = subjects
    .map((s) => ({ ...s, plans: s.plans.filter((p) => !termId || p.term_id === termId) }))
    .filter((s) => s.plans.length > 0);

  // Promedio del lapso: media de lo evaluado en cada materia con notas (orientativo).
  const averages = visible.flatMap((s) => s.plans.map((p) => p.current_average)).filter((v) => v !== null);
  const overall = averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
  const finals = visible.flatMap((s) => s.plans).filter((p) => p.status === 'final').length;
  const allCollapsed = visible.length > 0 && visible.every((s) => collapsed.has(s.key));

  return (
    <div>
      <div className="grades-toolbar">
        {periods.length > 1 && (
          <Select sorted value={schoolPeriodId || data.school_period?.id} onChange={(e) => { setSchoolPeriodId(e.target.value); setTermId(''); }} aria-label="Año escolar">
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                Año escolar {p.name}
              </option>
            ))}
          </Select>
        )}
        {terms.length > 0 && (
          <div className="level-filter" role="group" aria-label="Lapso">
            {[{ id: '', name: 'Todos los lapsos' }, ...terms].map((t) => (
              <button
                key={t.id || 'all'}
                type="button"
                className={`level-filter__item ${termId === t.id ? 'level-filter__item--active' : ''}`}
                onClick={() => setTermId(t.id)}
                aria-pressed={termId === t.id}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        {visible.length > 1 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm grades-toolbar__toggle"
            onClick={() => setAll(allCollapsed ? new Set() : new Set(visible.map((s) => s.key)))}
          >
            <Icon name="chevronDown" size={15} className={allCollapsed ? '' : 'is-flipped'} />
            {allCollapsed ? 'Expandir todas' : 'Contraer todas'}
          </button>
        )}
      </div>

      {subjects.length === 0 ? (
        <EmptyGrades
          title="Aún no hay planes de evaluación"
          text={`Cuando los docentes publiquen los planes de ${data.school_period.name}, aquí verás cada materia con sus actividades y notas.`}
        />
      ) : (
        <>
          <div className="grades-summary">
            <div>
              <span className="student-card__label">Promedio de lo evaluado</span>
              <span className={`grades-summary__value ${gradeTone(overall, passing)}`}>
                {fmt(overall)} <small>/ {scale}</small>
              </span>
            </div>
            <div>
              <span className="student-card__label">Materias</span>
              <span className="grades-summary__value">{visible.length}</span>
            </div>
            <div>
              <span className="student-card__label">Con nota definitiva</span>
              <span className="grades-summary__value">
                {finals} <small>de {visible.reduce((n, s) => n + s.plans.length, 0)}</small>
              </span>
            </div>
            <p className="grades-summary__note">
              Escala de 0 a {scale}; se aprueba con {passing}. El promedio general es orientativo: se calcula con lo evaluado hasta hoy.
            </p>
          </div>

          <div className="subject-list">
            {visible.map((subject) => (
              <SubjectCard
                key={subject.key}
                subject={subject}
                collapsed={collapsed.has(subject.key)}
                onToggle={() => toggle(subject.key)}
                scale={scale}
                passing={passing}
                showTerm={!termId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Resumen de una materia para la cabecera: una etiqueta por lapso con su nota. */
function SubjectSummary({ plans, passing }) {
  return (
    <span className="subject-card__summary">
      {plans.map((plan) => {
        const value = plan.final_grade ?? (plan.graded_count ? plan.accumulated : null);
        const tone = gradeTone(plan.status === 'final' ? plan.final_grade : plan.current_average, passing);
        return (
          <span key={plan.plan_id} className={`grade-chip ${value === null ? 'grade--none' : tone}`} title={PLAN_STATUS[plan.status].label}>
            <span className="grade-chip__term">{plan.term_name}</span>
            <strong>{fmt(value)}</strong>
            <span className="grade-chip__kind">{plan.status === 'final' ? 'Def.' : value === null ? 'Sin notas' : 'Acum.'}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Materia colapsable: toda la cabecera es un botón (con teclado y lector de
 * pantalla). Colapsada, solo queda el nombre y el resumen de notas; el
 * contenido se anima con grid-template-rows y queda `inert` (fuera del orden
 * de tabulación) mientras no se ve.
 */
export function SubjectCard({ subject, collapsed, onToggle, scale, passing, showTerm }) {
  const bodyId = `subject-body-${String(subject.key).replace(/[^a-z0-9-]/gi, '-')}`;
  return (
    <section className={`subject-card ${collapsed ? 'is-collapsed' : ''}`}>
      <h3 className="subject-card__head">
        <button type="button" className="subject-card__toggle" onClick={onToggle} aria-expanded={!collapsed} aria-controls={bodyId}>
          <span className="subject-card__title">
            {subject.name}
            {subject.code && <span className="chip">{subject.code}</span>}
          </span>
          <SubjectSummary plans={subject.plans} passing={passing} />
          <Icon name="chevronDown" size={18} className="subject-card__chevron" />
        </button>
      </h3>
      <div id={bodyId} className="subject-card__body" aria-hidden={collapsed} {...(collapsed ? { inert: '' } : {})}>
        <div className="subject-card__inner">
          {subject.plans.map((plan) => (
            <PlanGrades key={plan.plan_id} plan={plan} scale={scale} passing={passing} showTerm={showTerm} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlanGrades({ plan, scale, passing, showTerm }) {
  const status = PLAN_STATUS[plan.status];
  const headline = plan.final_grade ?? plan.accumulated;

  return (
    <div className="plan-grades">
      <div className="plan-grades__head">
        <div>
          {showTerm && <div className="plan-grades__term">{plan.term_name}</div>}
          <div className="cell-person__sub">
            Prof. {plan.teacher_name} · {plan.section}
            {plan.section_withdrawn && ' (sección anterior)'}
          </div>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      {plan.status === 'no_activities' ? (
        <p className="text-muted text-sm" style={{ margin: '8px 0 0' }}>
          El docente aún no ha cargado las actividades de este plan.
        </p>
      ) : (
        <>
          <div className="plan-grades__metrics">
            <div className={`grade-big ${gradeTone(plan.status === 'final' ? headline : plan.current_average, passing)}`}>
              <span className="grade-big__value">{fmt(headline)}</span>
              <span className="grade-big__scale">/ {scale}</span>
              <span className="grade-big__label">{plan.status === 'final' ? 'Nota definitiva' : 'Acumulado'}</span>
            </div>
            <div className="plan-grades__progress">
              <div className="coverage__head">
                <span>
                  Evaluado <strong>{fmt(plan.evaluated_weight, 0)}%</strong> del plan
                </span>
                {plan.current_average !== null && plan.status !== 'final' && (
                  <span className={gradeTone(plan.current_average, passing)}>
                    Promedio de lo evaluado: <strong>{fmt(plan.current_average)}</strong>
                  </span>
                )}
              </div>
              <div className="progress-bar">
                <div className="progress-bar__fill" style={{ width: `${Math.min(100, plan.evaluated_weight)}%` }} />
              </div>
              {plan.status !== 'final' && plan.evaluated_weight > 0 && (
                <p className="form-hint" style={{ margin: '6px 0 0' }}>
                  Lleva {fmt(plan.accumulated)} de los {fmt((plan.evaluated_weight / 100) * scale)} puntos evaluados hasta ahora; quedan{' '}
                  {fmt(((100 - plan.evaluated_weight) / 100) * scale)} por evaluar.
                </p>
              )}
            </div>
          </div>

          <div className="table-wrap table-wrap--stack">
            <table className="table table--stack grades-table">
              <thead>
                <tr>
                  <th>Actividad</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Vale</th>
                  <th style={{ textAlign: 'right' }}>Nota</th>
                  <th style={{ textAlign: 'right' }}>Puntos</th>
                </tr>
              </thead>
              <tbody>
                {plan.activities.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Actividad">
                      <div className="cell-person__name">{a.title}</div>
                      {a.graded_at && <div className="cell-person__sub">Calificada el {formatDate(a.graded_at)}</div>}
                    </td>
                    <td data-label="Tipo">{CATEGORY_LABELS[a.category] || a.category}</td>
                    <td data-label="Vale" style={{ textAlign: 'right' }}>{fmt(a.weight_percent, 2)}%</td>
                    <td data-label="Nota" style={{ textAlign: 'right' }}>
                      {a.raw_score === null ? (
                        <span className="text-muted">Sin nota</span>
                      ) : (
                        <span className={gradeTone(a.scaled_score, passing)}>
                          <strong>{fmt(a.raw_score, 2)}</strong>/{fmt(a.max_score, 0)}
                          {a.max_score !== scale && <span className="cell-person__sub"> ({fmt(a.scaled_score)}/{scale})</span>}
                        </span>
                      )}
                    </td>
                    <td data-label="Puntos" style={{ textAlign: 'right' }}>
                      {a.raw_score === null ? '—' : `${fmt((a.earned_percent / 100) * scale, 2)} de ${fmt((a.weight_percent / 100) * scale, 2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {plan.project && (
        <div className="plan-project">
          <div className="student-card__label">
            <Icon name="sparkles" size={14} /> Proyecto: {plan.project.title}
          </div>
          <ul>
            {plan.project.competencies.map((c) => (
              <li key={c.id}>
                <span>{c.description}</span>
                {c.result === 'achieved' ? (
                  <Badge variant="success">Logrado</Badge>
                ) : c.result === 'needs_improvement' ? (
                  <Badge variant="warning">En proceso</Badge>
                ) : (
                  <Badge variant="neutral">Sin evaluar</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyGrades({ title, text }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name="clipboard" size={24} />
      </div>
      <div className="empty-state__title">{title}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

export default StudentGrades;
