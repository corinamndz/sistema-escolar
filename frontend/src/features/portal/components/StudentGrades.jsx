import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import Tabs from '../../../components/ui/Tabs';
import PortalSubjectProgram from './PortalSubjectProgram';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import Drawer from '../../../components/ui/Drawer';
import { formatDate } from '../../payments/paymentStatus';
import { isQualitative, literalFor } from '../../grading/gradingScale';
import LiteralBadge from '../../grading/components/LiteralBadge';

const CATEGORY_LABELS = { formative: 'Formativa', exam: 'Examen', project: 'Proyecto', homework: 'Tarea', other: 'Otra' };
/** La clave de una materia del plan de estudios es su id; la de un área de Inicial, su nombre. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 16.3 → "16,3" */
const fmt = (n, digits = 1) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** Clase de color según la nota: aprobado / reprobado / sin datos. */
const gradeTone = (value, passing) => (value === null || value === undefined ? 'grade--none' : value >= passing ? 'grade--pass' : 'grade--fail');

/**
 * Semáforo sobre el promedio de lo ya calificado, con los cortes en escala de 20
 * (16 y 10) y proporcionales en otras escalas.
 */
const LIGHTS = {
  green: { label: 'Buen rendimiento', range: '16 o más' },
  yellow: { label: 'Puede mejorar', range: '10 a 15' },
  red: { label: 'Requiere atención', range: 'Menos de 10' },
};
function trafficLight(value, scale) {
  if (value === null || value === undefined) return null;
  const on20 = (Number(value) * 20) / scale;
  if (on20 >= 16) return 'green';
  if (on20 >= 10) return 'yellow';
  return 'red';
}

/** Nota que decide el semáforo de un plan: la definitiva o el promedio de lo calificado. */
const planScore = (plan) => (plan.status === 'final' ? plan.final_grade : plan.current_average);

const mean = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + Number(b), 0) / v.length : null;
};

/** Lapso por defecto: el último con alguna nota cargada (o el primero). */
function defaultTermId(terms, subjects) {
  const graded = new Set(subjects.flatMap((s) => s.plans.filter((p) => p.graded_count > 0).map((p) => p.term_id)));
  const withGrades = terms.filter((t) => graded.has(t.id));
  return (withGrades[withGrades.length - 1] || terms[0])?.id || '';
}

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
function StudentGrades({ studentId }) {
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const [pickedTermId, setPickedTermId] = useState(null); // null = lapso por defecto
  // Aviso "Plan de evaluación publicado" (?materia=<id>): abre esa materia en "Contenido y evaluaciones".
  const [params, setParams] = useSearchParams();
  const [openSubject, setOpenSubject] = useState(() => params.get('materia') || null);
  const [subjectTab, setSubjectTab] = useState(() => (params.get('materia') ? 'program' : 'grades'));
  useEffect(() => {
    if (!params.has('materia')) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('materia');
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openSubjectDetail = (key) => {
    setSubjectTab('grades');
    setOpenSubject(key);
  };
  const { data, loading, error } = useFetch(
    () => portalApi.getStudentGrades(studentId, schoolPeriodId ? { schoolPeriodId } : undefined),
    [studentId, schoolPeriodId]
  );

  if (loading) return <Spinner label="Cargando calificaciones…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { scale, passing_grade: passing, periods, terms, subjects } = data;

  if (periods.length === 0) {
    return <EmptyGrades title="Sin inscripciones" text="El alumno todavía no está inscrito en ninguna sección." />;
  }

  const termId = pickedTermId ?? defaultTermId(terms, subjects);
  const setTermId = setPickedTermId;

  // TODAS las materias se muestran, también las que aún no tienen plan (en
  // general o en el lapso elegido): se ven con "Sin plan de evaluación".
  const visible = subjects.map((s) => ({ ...s, plans: s.plans.filter((p) => !termId || p.term_id === termId) }));
  const termName = terms.find((t) => t.id === termId)?.name || null;

  // Promedio del lapso: media de lo evaluado en cada materia con notas (orientativo).
  const averages = visible.flatMap((s) => s.plans.map((p) => p.current_average)).filter((v) => v !== null);
  const overall = averages.length ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
  const finals = visible.flatMap((s) => s.plans).filter((p) => p.status === 'final').length;
  const selectedSubject = openSubject && visible.find((s) => s.key === openSubject);

  return (
    <div>
      <div className="grades-toolbar">
        {periods.length > 1 && (
          <Select sorted value={schoolPeriodId || data.school_period?.id} onChange={(e) => { setSchoolPeriodId(e.target.value); setTermId(null); }} aria-label="Año escolar">
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                Año escolar {p.name}
              </option>
            ))}
          </Select>
        )}
        {terms.length > 0 && (
          <div className="level-filter" role="group" aria-label="Lapso">
            {[...terms, { id: '', name: 'Todos los lapsos' }].map((t) => (
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
              {isQualitative(data.grading_scale) ? (
                <span className="grades-summary__value">
                  <LiteralBadge level={literalFor(overall)} showLabel size="lg" />
                </span>
              ) : (
                <span className={`grades-summary__value ${gradeTone(overall, passing)}`}>
                  {fmt(overall)} <small>/ {scale}</small>
                </span>
              )}
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
              {isQualitative(data.grading_scale)
                ? `Escala cualitativa: ${(data.scale_def?.qualitative_levels || []).map((l) => `${l.code} ${l.label.toLowerCase()}`).join(' · ')}. El promedio es orientativo: se calcula con lo evaluado hasta hoy.`
                : `Escala de 0 a ${scale}; se aprueba con ${passing}. El promedio general es orientativo: se calcula con lo evaluado hasta hoy.`}
            </p>
          </div>

          {!isQualitative(data.grading_scale) && (
            <ul className="tl-legend" aria-label="Significado de los colores">
              {Object.entries(LIGHTS).map(([key, l]) => (
                <li key={key}>
                  <span className={`tl-dot tl-dot--${key}`} aria-hidden="true" />
                  <strong>{l.label}</strong> {l.range}
                </li>
              ))}
            </ul>
          )}

          <div className="grade-cards">
            {visible.map((subject) => (
              <SubjectGradeCard
                key={subject.key}
                subject={subject}
                scale={scale}
                termName={termName}
                allTerms={!termId}
                onOpen={() => openSubjectDetail(subject.key)}
              />
            ))}
          </div>
        </>
      )}

      {selectedSubject && (
        <Drawer
          title={selectedSubject.name}
          subtitle={subjectTab === 'grades' && termName ? `Calificaciones · ${termName}` : `${data.school_period?.name ? `Año escolar ${data.school_period.name}` : ''}`}
          icon="book"
          size="lg"
          onClose={() => setOpenSubject(null)}
        >
          {/* Materias del plan de estudios (con id): también su contenido programático y evaluaciones publicadas. */}
          {UUID.test(selectedSubject.key) && (
            <Tabs
              tabs={[
                { key: 'grades', label: 'Calificaciones' },
                { key: 'program', label: 'Contenido y evaluaciones' },
              ]}
              active={subjectTab}
              onChange={setSubjectTab}
            />
          )}
          {subjectTab === 'program' && UUID.test(selectedSubject.key) ? (
            <PortalSubjectProgram studentId={studentId} subjectId={selectedSubject.key} schoolPeriodId={data.school_period?.id} />
          ) : (
            <SubjectDetail subject={selectedSubject} scale={scale} passing={passing} showTerm={!termId} termName={termName} />
          )}
        </Drawer>
      )}
    </div>
  );
}

/** Semáforo de tres luces; enciende la que corresponde a la nota. */
function TrafficLight({ light }) {
  return (
    <span className="tl" role="img" aria-label={light ? LIGHTS[light].label : 'Sin notas'}>
      {['red', 'yellow', 'green'].map((k) => (
        <span key={k} className={`tl-dot tl-dot--${k} ${light === k ? 'is-on' : ''}`} />
      ))}
    </span>
  );
}

/**
 * Tarjeta de una materia en el lapso elegido: acumulado, promedio de lo
 * calificado con su semáforo y avance del plan. Con "Todos los lapsos", el
 * semáforo usa la media de los lapsos y debajo va la nota de cada uno.
 */
function SubjectGradeCard({ subject, scale, termName, allTerms, onOpen }) {
  const plans = subject.plans;
  const qualitative = plans.some((p) => isQualitative(p.grading_scale));
  const plan = plans.find((p) => p.graded_count > 0) || plans[0] || null;

  const score = allTerms ? mean(plans.map(planScore)) : plan && planScore(plan);
  const light = trafficLight(score, scale);
  const headline = allTerms ? score : plan && (plan.final_grade ?? (plan.graded_count ? plan.accumulated : null));
  const literal = qualitative ? literalFor(score) : null;
  const gradedActivities = plans.reduce((n, p) => n + p.activities.filter((a) => a.raw_score !== null).length, 0);
  const totalActivities = plans.reduce((n, p) => n + p.activities.length, 0);

  let caption;
  if (!plan) caption = termName ? `Sin plan de evaluación en ${termName}` : 'Sin plan de evaluación';
  else if (allTerms) caption = 'Promedio de los lapsos';
  else if (plan.status === 'final') caption = 'Nota definitiva';
  else if (headline === null) caption = 'Aún sin notas';
  else caption = 'Acumulado del lapso';

  return (
    <button type="button" className={`grade-card ${light ? `grade-card--${light}` : 'grade-card--none'}`} onClick={onOpen} aria-haspopup="dialog">
      <span className="grade-card__head">
        <span className="grade-card__title">
          {subject.name}
          {subject.code && <span className="chip">{subject.code}</span>}
        </span>
        <TrafficLight light={light} />
      </span>
      <span className="grade-card__teacher">{plan?.teacher_name ? `Prof. ${plan.teacher_name}` : 'Docente por asignar'}</span>

      <span className="grade-card__score">
        {literal ? (
          <LiteralBadge level={literal} size="lg" showLabel />
        ) : (
          <>
            <span className="grade-card__value">{fmt(headline)}</span>
            <span className="grade-card__scale">/ {scale}</span>
          </>
        )}
      </span>
      <span className="grade-card__caption">{caption}</span>

      {allTerms ? (
        <SubjectSummary plans={plans} scale={scale} />
      ) : (
        plan && (
          <span className="grade-card__progress">
            <span className="grade-card__progress-head">
              <span>Evaluado {fmt(plan.evaluated_weight, 0)}%</span>
              {plan.status !== 'final' && plan.current_average !== null && !qualitative && <span>Promedio {fmt(plan.current_average)}</span>}
            </span>
            <span className="progress-bar">
              <span className="progress-bar__fill" style={{ width: `${Math.min(100, plan.evaluated_weight)}%` }} />
            </span>
          </span>
        )
      )}

      <span className="grade-card__foot">
        <span>{light ? LIGHTS[light].label : totalActivities ? `${totalActivities} actividades por calificar` : 'Sin actividades'}</span>
        {totalActivities > 0 && (
          <span className="grade-card__more">
            {gradedActivities}/{totalActivities} calificadas <Icon name="chevronRight" size={14} />
          </span>
        )}
      </span>
    </button>
  );
}

/** Desglose de la materia en el modal: un bloque por plan (lapso). */
function SubjectDetail({ subject, scale, passing, showTerm, termName }) {
  if (subject.plans.length === 0) {
    return (
      <p className="text-muted text-sm" style={{ margin: 0 }}>
        {termName
          ? `Aún no hay plan de evaluación de ${subject.name} para ${termName}.`
          : `Aún no hay plan de evaluación de ${subject.name}: cuando el docente lo publique, aquí verás sus actividades y notas.`}
      </p>
    );
  }
  return (
    <div className="grade-detail">
      {subject.plans.map((plan) => (
        <PlanGrades key={plan.plan_id} plan={plan} scale={scale} passing={passing} showTerm={showTerm} />
      ))}
    </div>
  );
}

/** Una etiqueta por lapso con su nota, coloreada con el semáforo. */
function SubjectSummary({ plans, scale }) {
  if (!plans.length) return null;
  return (
    <span className="subject-card__summary grade-card__terms">
      {plans.map((plan) => {
        const value = plan.final_grade ?? (plan.graded_count ? plan.accumulated : null);
        const light = trafficLight(planScore(plan), scale);
        const tone = light ? `grade-chip--${light}` : 'grade--none';
        // Cualitativa: el literal del promedio (definitiva o de lo evaluado hasta hoy).
        const literal = isQualitative(plan.grading_scale) ? literalFor(plan.status === 'final' ? plan.final_grade : plan.current_average) : null;
        return (
          <span key={plan.plan_id} className={`grade-chip ${value === null ? 'grade--none' : tone}`} title={literal ? `${literal.code} · ${literal.label}` : PLAN_STATUS[plan.status].label}>
            <span className="grade-chip__term">{plan.term_name}</span>
            <strong>{literal ? literal.code : fmt(value)}</strong>
            <span className="grade-chip__kind">{plan.status === 'final' ? 'Def.' : value === null ? 'Sin notas' : 'Acum.'}</span>
          </span>
        );
      })}
    </span>
  );
}

function PlanGrades({ plan, scale, passing, showTerm }) {
  const status = PLAN_STATUS[plan.status];
  const headline = plan.final_grade ?? plan.accumulated;
  const qualitative = isQualitative(plan.grading_scale);
  const headLiteral = qualitative ? literalFor(plan.status === 'final' ? plan.final_grade : plan.current_average) : null;

  return (
    <div className="plan-grades">
      <div className="plan-grades__head">
        <div>
          {showTerm && <div className="plan-grades__term">{plan.term_name}</div>}
          <div className="cell-person__sub">
            {plan.teacher_name ? `Prof. ${plan.teacher_name}` : 'Docente por asignar'} · {plan.section}
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
            {qualitative ? (
              <div className="grade-big grade-big--literal">
                <LiteralBadge level={headLiteral} size="xl" />
                <span className="grade-big__label">
                  {headLiteral ? headLiteral.label : 'Sin notas'} · {plan.status === 'final' ? 'Nota definitiva' : 'Lo evaluado hasta hoy'}
                </span>
              </div>
            ) : (
              <div className={`grade-big grade-big--${trafficLight(planScore(plan), scale) || 'none'}`}>
                <span className="grade-big__value">{fmt(headline)}</span>
                <span className="grade-big__scale">/ {scale}</span>
                <span className="grade-big__label">{plan.status === 'final' ? 'Nota definitiva' : 'Acumulado'}</span>
              </div>
            )}
            <div className="plan-grades__progress">
              <div className="coverage__head">
                <span>
                  Evaluado <strong>{fmt(plan.evaluated_weight, 0)}%</strong> del plan
                </span>
                {!qualitative && plan.current_average !== null && plan.status !== 'final' && (
                  <span className={gradeTone(plan.current_average, passing)}>
                    Promedio de lo evaluado: <strong>{fmt(plan.current_average)}</strong>
                  </span>
                )}
              </div>
              <div className="progress-bar">
                <div className="progress-bar__fill" style={{ width: `${Math.min(100, plan.evaluated_weight)}%` }} />
              </div>
              {!qualitative && plan.status !== 'final' && plan.evaluated_weight > 0 && (
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
                  {!qualitative && <th style={{ textAlign: 'right' }}>Puntos</th>}
                  <th>Estado</th>
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
                      ) : qualitative ? (
                        <LiteralBadge level={literalFor(a.scaled_score)} showLabel />
                      ) : (
                        <span className={gradeTone(a.scaled_score, passing)}>
                          <strong>{fmt(a.raw_score, 2)}</strong>/{fmt(a.max_score, 0)}
                          {a.max_score !== scale && <span className="cell-person__sub"> ({fmt(a.scaled_score)}/{scale})</span>}
                        </span>
                      )}
                    </td>
                    {!qualitative && (
                      <td data-label="Puntos" style={{ textAlign: 'right' }}>
                        {a.raw_score === null ? '—' : `${fmt((a.earned_percent / 100) * scale, 2)} de ${fmt((a.weight_percent / 100) * scale, 2)}`}
                      </td>
                    )}
                    <td data-label="Estado">
                      {a.raw_score === null ? <Badge variant="neutral">Pendiente</Badge> : <Badge variant="success">Calificada</Badge>}
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
