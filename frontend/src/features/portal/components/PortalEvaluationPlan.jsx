import { useState } from 'react';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { CATEGORY_LABELS } from '../../programmatic-content/categories';
import { PlannerTable } from '../../evaluation-plans/components/DetailedPlanner';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { maximumFractionDigits: 2 }));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Lapso por defecto: el último con alguna nota cargada (o el primero). */
function defaultTermId(terms, subjects) {
  const graded = new Set(subjects.flatMap((s) => s.plans.filter((p) => p.graded_count > 0).map((p) => p.term_id)));
  const withGrades = terms.filter((t) => graded.has(t.id));
  return (withGrades[withGrades.length - 1] || terms[0])?.id || '';
}

/**
 * Pestaña "Plan de evaluación" del portal del representante. Primero las
 * materias del alumno en tarjetas; al elegir una, su plan completo en formato
 * planificador (referencias, estrategia, criterios e indicadores, puntaje,
 * ponderación y fecha de aplicación en su sección), solo lectura.
 */
function PortalEvaluationPlan({ studentId }) {
  const [schoolPeriodId, setSchoolPeriodId] = useState('');
  const [pickedTermId, setPickedTermId] = useState(null);
  const [subjectKey, setSubjectKey] = useState(null);
  const { data, loading, error } = useFetch(
    () => portalApi.getStudentGrades(studentId, schoolPeriodId ? { schoolPeriodId } : undefined),
    [studentId, schoolPeriodId]
  );

  if (loading) return <Spinner label="Cargando plan de evaluación…" />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const { periods, terms, subjects } = data;
  if (periods.length === 0) {
    return <EmptyPlan title="Sin inscripciones" text="El alumno todavía no está inscrito en ninguna sección." />;
  }

  const termId = pickedTermId ?? defaultTermId(terms, subjects);
  const termName = terms.find((t) => t.id === termId)?.name || null;
  const visible = subjects.map((s) => ({ ...s, plans: s.plans.filter((p) => !termId || p.term_id === termId) }));
  const selected = subjectKey && visible.find((s) => s.key === subjectKey);

  const toolbar = (
    <div className="grades-toolbar">
      {selected && (
        <Button variant="secondary" size="sm" icon="arrowLeft" onClick={() => setSubjectKey(null)}>
          Materias
        </Button>
      )}
      {!selected && periods.length > 1 && (
        <Select
          sorted
          value={schoolPeriodId || data.school_period?.id}
          onChange={(e) => {
            setSchoolPeriodId(e.target.value);
            setPickedTermId(null);
          }}
          aria-label="Año escolar"
        >
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
              onClick={() => setPickedTermId(t.id)}
              aria-pressed={termId === t.id}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (selected) {
    return (
      <div>
        {toolbar}
        <SubjectPlanDetail studentId={studentId} subject={selected} termName={termName} />
      </div>
    );
  }

  return (
    <div>
      {toolbar}
      {subjects.length === 0 ? (
        <EmptyPlan title="Aún no hay materias" text="Cuando el colegio configure las materias del grado, aquí verás su plan de evaluación." />
      ) : (
        <>
          <p className="eplan-intro text-sm text-muted">
            Elige una materia para ver su plan de evaluación completo{termName ? ` del ${termName}` : ''}: qué se evalúa, cómo, con qué criterios, cuánto vale y cuándo.
          </p>
          <div className="grade-cards">
            {visible.map((s) => (
              <SubjectCard key={s.key} subject={s} termName={termName} onOpen={() => setSubjectKey(s.key)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SubjectCard({ subject, termName, onOpen }) {
  const { plans } = subject;
  const activities = plans.reduce((n, p) => n + p.activity_count, 0);
  const graded = plans.reduce((n, p) => n + p.graded_count, 0);
  const teachers = [...new Set(plans.map((p) => p.teacher_name).filter(Boolean))];
  const single = plans.length === 1 ? plans[0] : null;

  if (!plans.length) {
    return (
      <div className="grade-card grade-card--none eplan-card is-disabled">
        <span className="grade-card__head">
          <span className="grade-card__title">
            {subject.name}
            {subject.code && <span className="chip">{subject.code}</span>}
          </span>
        </span>
        <span className="grade-card__teacher">Sin plan de evaluación publicado{termName ? ` en ${termName}` : ''}</span>
      </div>
    );
  }

  return (
    <button type="button" className="grade-card grade-card--none eplan-card" onClick={onOpen}>
      <span className="grade-card__head">
        <span className="grade-card__title">
          {subject.name}
          {subject.code && <span className="chip">{subject.code}</span>}
        </span>
        <span className="eplan-card__icon" aria-hidden="true">
          <Icon name="clipboard" size={18} />
        </span>
      </span>
      <span className="grade-card__teacher">{teachers.length ? `Prof. ${teachers.join(', ')}` : 'Docente por asignar'}</span>
      <span className="eplan-card__stats">
        <span>
          <strong>{activities}</strong> {activities === 1 ? 'actividad' : 'actividades'}
        </span>
        <span>
          <strong>{graded}</strong> {graded === 1 ? 'calificada' : 'calificadas'}
        </span>
        {!single && (
          <span>
            <strong>{plans.length}</strong> lapsos
          </span>
        )}
      </span>
      {single && (
        <span className="grade-card__progress">
          <span className="grade-card__progress-head">
            <span>Evaluado {fmt(single.evaluated_weight)}%</span>
            <span>de {fmt(single.total_weight)}%</span>
          </span>
          <span className="progress-bar">
            <span className="progress-bar__fill" style={{ width: `${Math.min(100, single.evaluated_weight)}%` }} />
          </span>
        </span>
      )}
      <span className="grade-card__foot">
        <span>Ver plan completo</span>
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

function SubjectPlanDetail({ studentId, subject, termName }) {
  if (!subject.plans.length) {
    return (
      <EmptyPlan
        title={`${subject.name} aún no tiene plan de evaluación${termName ? ` en ${termName}` : ''}`}
        text="Cuando el docente lo publique, aquí verás cada actividad con sus criterios, puntaje, ponderación y fecha."
      />
    );
  }
  return (
    <div className="eplan-detail">
      {subject.plans.map((p) => (
        <PlanDetail key={p.plan_id} studentId={studentId} planId={p.plan_id} />
      ))}
    </div>
  );
}

function PlanDetail({ studentId, planId }) {
  const { data: plan, loading, error } = useFetch(() => portalApi.getStudentPlanDetail(studentId, planId), [studentId, planId]);

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!plan) return null;

  return (
    <section className="card">
      <div className="card__header">
        <div>
          <h3 className="card__title eplan__title">
            {plan.subject}
            {plan.subject_code && <span className="chip">{plan.subject_code}</span>}
          </h3>
          <p className="card__subtitle">
            {plan.term_name} · {plan.grade_name} · Sección {plan.section.name} · {plan.teacher_name ? `Prof. ${plan.teacher_name}` : 'Docente por asignar'}
          </p>
        </div>
        <div className="eplan__meta">
          <Badge variant="neutral">{plural(plan.activities.length, 'actividad', 'actividades')}</Badge>
          <Badge variant={plan.total_weight === 100 ? 'success' : 'warning'}>Ponderación {fmt(plan.total_weight)}%</Badge>
        </div>
      </div>
      <PlannerTable activities={plan.activities} sections={[plan.section]} categoryLabels={CATEGORY_LABELS} />
    </section>
  );
}

function EmptyPlan({ title, text }) {
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

export default PortalEvaluationPlan;
