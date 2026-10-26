import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import programmaticContentApi from '../../../api/endpoints/programmaticContent.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { ReviewButton } from '../../reviews/components/ReviewWidgets';
import { TermBadge, termLabel } from '../terms';
import { INSTRUMENT_LABELS } from '../instruments';
import {
  ContentRefsEditor,
  CriteriaEditor,
  FORMATS,
  PlanSettings,
  PlannerTable,
  detailedBody,
  detailedFormFrom,
} from '../components/DetailedPlanner';

const CATEGORY_LABELS = {
  formative: 'Formativa',
  exam: 'Examen',
  project: 'Proyecto',
  homework: 'Tarea',
  other: 'Otra',
};

/** '2026-10-15' → "15 oct 2026" (fecha de calendario, sin corrimiento de zona horaria). */
function formatDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

function EvaluationPlanDetailPage() {
  const { id } = useParams();
  const { data: plan, loading, error, refetch } = useFetch(() => evaluationPlansApi.getOne(id), [id]);
  const [activityModal, setActivityModal] = useState(null); // null | {} (crear) | {...} (editar)
  const [showProjectForm, setShowProjectForm] = useState(false);
  const { run: deleteRun, error: deleteError } = useMutation((activityId) => evaluationPlansApi.deleteActivity(id, activityId));
  const confirm = useConfirm();
  const toast = useToast();
  const { can } = useAuth();

  const handleClose = async () => {
    const ok = await confirm({
      title: '¿Cerrar el plan de evaluación?',
      message: 'Las actividades y sus porcentajes quedarán bloqueados. Las notas se podrán seguir cargando. Podrás reabrirlo si necesitas corregir algo.',
      icon: 'lock',
      confirmLabel: 'Cerrar plan',
    });
    if (!ok) return;
    try {
      await evaluationPlansApi.close(id);
      toast.success('Plan cerrado', 'Las actividades quedaron bloqueadas.');
      refetch();
    } catch (err) {
      toast.error('No se pudo cerrar', getErrorMessage(err));
    }
  };

  const handleReopen = async () => {
    const ok = await confirm({
      title: '¿Reabrir el plan?',
      message: 'Se podrán volver a agregar, editar o eliminar actividades.',
      confirmLabel: 'Reabrir',
    });
    if (!ok) return;
    try {
      await evaluationPlansApi.reopen(id);
      toast.success('Plan reabierto');
      refetch();
    } catch (err) {
      toast.error('No se pudo reabrir', getErrorMessage(err));
    }
  };

  const handleDeleteActivity = async (activity) => {
    const ok = await confirm({
      title: activity.project ? '¿Eliminar el proyecto pedagógico?' : '¿Eliminar esta actividad?',
      message: activity.project
        ? `"${activity.title}" (${Number(activity.weight_percent)}%) se quitará del plan junto con sus ${activity.project.competencies.length} competencia(s); su porcentaje quedará disponible.`
        : `"${activity.title}" (${Number(activity.weight_percent)}%) se quitará del plan y su porcentaje quedará disponible.`,
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRun(activity.id);
      toast.success('Actividad eliminada');
      refetch();
    } catch {
      // error visible arriba
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!plan) return null;

  const closed = plan.status === 'closed';
  const activityColumns = [
    {
      key: 'title',
      header: 'Actividad',
      render: (a) => (
        <div>
          <div className="cell-person__name">{a.title}</div>
          {a.programmatic_content && <ContentTag content={a.programmatic_content} />}
          {a.description && <div className="cell-person__sub activity-description">{a.description}</div>}
          {a.project && <ProjectBlock project={a.project} canEdit={!closed} onChanged={refetch} />}
        </div>
      ),
      sortValue: (a) => a.title,
    },
    {
      key: 'planned_date',
      header: 'Fecha estimada',
      render: (a) => formatDay(a.planned_date) || <span className="text-muted">Sin fecha</span>,
      sortValue: (a) => a.planned_date,
    },
    { key: 'category', header: 'Tipo', render: (a) => <Badge variant="primary">{CATEGORY_LABELS[a.category] || a.category}</Badge> },
    {
      key: 'weight_percent',
      header: 'Peso',
      align: 'right',
      render: (a) => <strong>{Number(a.weight_percent)}%</strong>,
      sortValue: (a) => Number(a.weight_percent),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) => closed ? null : (
        <div className="table__actions">
          <RequirePermission module="evaluation_plans" action="update">
            <Button size="sm" variant="secondary" icon="pencil" onClick={() => setActivityModal(a)}>
              Editar
            </Button>
          </RequirePermission>
          <RequirePermission module="evaluation_plans" action="delete">
            <Button size="sm" variant="danger" icon="trash" onClick={() => handleDeleteActivity(a)}>
              Eliminar
            </Button>
          </RequirePermission>
        </div>
      ),
    },
  ];

  const totalWeight = Number(plan.totalWeight) || 0;
  const remaining = Math.max(0, Math.round((100 - totalWeight) * 100) / 100);
  // Proyecto anterior a la integración: existe pero aún no es una actividad ponderada del plan.
  const unweightedProject = plan.pedagogicalProject && !plan.pedagogicalProject.evaluation_activity_id ? plan.pedagogicalProject : null;
  const meterState = totalWeight > 100 ? 'over' : totalWeight === 100 ? 'complete' : 'partial';

  return (
    <div>
      <PageHeader
        title={plan.subject}
        subtitle={
          <span className="page-header__meta">
            {FORMATS[plan.format]?.label || 'Plan de evaluación'} · {plan.grade_name} {plan.sections.map((sec) => sec.name).join(', ')} · <TermBadge number={plan.term_number} name={plan.term_name} />
            {plan.term_start && plan.term_end && ` (${formatDay(plan.term_start)} – ${formatDay(plan.term_end)})`}
            {closed ? <Badge variant="success">Cerrado</Badge> : <Badge variant="info">Abierto</Badge>}
          </span>
        }
        actions={
          <>
            {/* Revisión y aprobación: el docente envía; coordinación del nivel o dirección revisan. */}
            <ReviewButton target={{ planId: plan.id }} title={plan.subject || ''} status={plan.review_status} onChanged={refetch} />
            {plan.subject_id && (
              <Link to={`/programmatic-content?materia=${plan.subject_id}&grado=${plan.grade_id}&ano=${plan.school_period_id}`} className="btn btn--secondary">
                Contenido programático
              </Link>
            )}
            {/* Calificaciones es otro módulo (el coordinador, por ejemplo, no lo tiene). */}
            {can('grading', 'read') && (
              <Link to={`/grading/plans/${id}`} className="btn btn--secondary">
                Ver calificaciones
              </Link>
            )}
            <Link to="/evaluation-plans" className="btn btn--secondary">
              Volver
            </Link>
          </>
        }
      />

      <Card title="Configuración del plan" subtitle="Lapso académico, tipo de formato y secciones a las que se aplica">
        <PlanSettings plan={plan} canEdit={can('evaluation_plans', 'update')} onChanged={refetch} />
      </Card>

      <Card
        title={`Total acumulado del ${termLabel(plan.term_number, plan.term_name)}`}
        subtitle="El plan debe sumar exactamente 100% de la nota para poder cerrarse"
        actions={
          <RequirePermission module="evaluation_plans" action="update">
            {closed ? (
              <Button size="sm" variant="secondary" icon="lock" onClick={handleReopen}>
                Reabrir plan
              </Button>
            ) : (
              <Button
                size="sm"
                icon="lock"
                onClick={handleClose}
                disabled={totalWeight !== 100}
                title={totalWeight === 100 ? 'Bloquear actividades y porcentajes' : `Faltan ${remaining}% para poder cerrarlo`}
              >
                Cerrar plan
              </Button>
            )}
          </RequirePermission>
        }
      >
        {closed && (
          <Alert variant="success">
            Plan cerrado{plan.closed_at ? ` el ${new Date(plan.closed_at).toLocaleDateString('es')}` : ''}: las actividades y sus
            porcentajes están bloqueados. Las calificaciones se siguen cargando con normalidad.
          </Alert>
        )}
        <div className={`progress-meter progress-meter--${meterState}`}>
          <div className="progress-meter__head">
            <span className="progress-meter__value">
              {totalWeight}% <small>/ 100%</small>
            </span>
            {meterState === 'complete' ? (
              <Badge variant="success">Plan completo</Badge>
            ) : meterState === 'over' ? (
              <Badge variant="danger">Excede el 100%</Badge>
            ) : (
              <Badge variant="warning">Faltan {remaining}%</Badge>
            )}
          </div>
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuenow={totalWeight}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-bar__fill" style={{ width: `${Math.min(100, totalWeight)}%` }} />
          </div>
          <div className="progress-meter__foot">
            <Icon name={meterState === 'complete' ? 'checkCircle' : 'info'} size={15} />
            {remaining > 0
              ? `Queda ${remaining}% disponible para nuevas actividades. Hasta completar el 100% no se puede cerrar el plan.`
              : closed
                ? 'El plan suma 100% y está cerrado.'
                : 'El plan ya suma 100%: puedes cerrarlo para bloquear las actividades.'}
          </div>
        </div>
      </Card>

      <Card
        title={`Actividades de evaluación · ${termLabel(plan.term_number, plan.term_name)}`}
        subtitle="Incluye el proyecto pedagógico de aula: se pondera y se califica como una actividad más del lapso."
        actions={
          <RequirePermission module="evaluation_plans" action="create">
            {!closed && (
              <div className="table__actions">
                {!plan.pedagogicalProject && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="sparkles"
                    onClick={() => setShowProjectForm(true)}
                    disabled={remaining <= 0}
                    title={remaining <= 0 ? 'El plan ya suma 100%' : 'Agregar el proyecto pedagógico de aula con su ponderación'}
                  >
                    Proyecto pedagógico
                  </Button>
                )}
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() => setActivityModal({})}
                  disabled={remaining <= 0}
                  title={remaining <= 0 ? 'El plan ya suma 100%' : undefined}
                >
                  Nueva actividad
                </Button>
              </div>
            )}
          </RequirePermission>
        }
      >
        <Alert>{deleteError}</Alert>
        {unweightedProject && (
          <div className="project-pending">
            <Alert variant="warning">
              El proyecto pedagógico «{unweightedProject.title}» aún no tiene ponderación: no cuenta en la nota del lapso. Asígnale su porcentaje
              para que se califique dentro del plan.
            </Alert>
            {!closed && can('evaluation_plans', 'create') && (
              <Button size="sm" icon="sparkles" onClick={() => setShowProjectForm(true)} disabled={remaining <= 0} title={remaining <= 0 ? 'El plan ya suma 100%' : undefined}>
                Asignar ponderación
              </Button>
            )}
          </div>
        )}
        {plan.format === 'detailed' ? (
          <PlannerTable
            activities={plan.activities}
            sections={plan.sections}
            categoryLabels={CATEGORY_LABELS}
            renderTitleExtra={(a) => a.project && <ProjectBlock project={a.project} canEdit={!closed} onChanged={refetch} />}
            renderActions={closed ? null : (a) => activityColumns.find((c) => c.key === 'actions').render(a)}
          />
        ) : (
          <Table columns={activityColumns} rows={plan.activities} emptyMessage="Aún no hay actividades en este plan." />
        )}
      </Card>

      {activityModal !== null && (
        <ActivityFormModal
          plan={plan}
          planId={id}
          initial={activityModal}
          remaining={remaining + (activityModal.weight_percent ? Number(activityModal.weight_percent) : 0)}
          termStart={plan.term_start}
          termEnd={plan.term_end}
          onClose={() => setActivityModal(null)}
          onSaved={refetch}
        />
      )}

      {showProjectForm && (
        <ProjectFormModal
          planId={id}
          plan={plan}
          existing={unweightedProject}
          remaining={remaining}
          onClose={() => setShowProjectForm(false)}
          onCreated={refetch}
        />
      )}
    </div>
  );
}

/** "Unidad I · Estructura celular": tema del contenido programático que evalúa la actividad. */
export function ContentTag({ content }) {
  return (
    <span className="pc-tag" title="Tema del contenido programático">
      <Icon name="layers" size={12} /> {content.unit} · {content.topic}
    </span>
  );
}

function ActivityFormModal({ plan, planId, initial, remaining, termStart, termEnd, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  // Temas del contenido programático de la materia en el grado del plan (si es una materia del catálogo).
  const { data: content } = useFetch(
    () => (plan.subject_id ? programmaticContentApi.get({ gradeId: plan.grade_id, subjectId: plan.subject_id }) : Promise.resolve(null)),
    [plan.subject_id, plan.grade_id]
  );
  const [contentId, setContentId] = useState(initial.programmatic_content_id || '');
  const [instrument, setInstrument] = useState(initial.instrument || '');
  const detailed = plan.format === 'detailed';
  // Formato detallado: estrategia, referencias, criterios/indicadores con puntaje y fechas por sección.
  const [dForm, setDForm] = useState(() => detailedFormFrom(initial, plan.sections));
  const [localError, setLocalError] = useState(null);
  // Con notas registradas solo se corrigen textos (el backend también lo valida).
  const locked = Boolean(initial.has_scores);
  const [form, setForm] = useState({
    title: initial.title || '',
    category: initial.category || 'formative',
    weightPercent: initial.weight_percent || '',
    description: initial.description || '',
    plannedDate: initial.planned_date || '',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit
      ? (data) => evaluationPlansApi.updateActivity(planId, initial.id, data)
      : (data) => evaluationPlansApi.createActivity(planId, data)
  );
  const toast = useToast();

  // Validación en tiempo real contra el porcentaje disponible del plan (el backend
  // vuelve a validar y responde 422 si se excede el 100%).
  const typed = form.weightPercent === '' ? null : Number(form.weightPercent);
  const weightError =
    typed === null
      ? null
      : !(typed > 0)
        ? 'Debe ser mayor que 0.'
        : Math.abs(typed * 100 - Math.round(typed * 100)) >= 1e-6
          ? 'Usa como máximo 2 decimales.'
        : typed > remaining
          ? `Excede lo disponible: el plan quedaría en ${Math.round((100 - remaining + typed) * 100) / 100}%.`
          : null;
  const afterSave = typed && !weightError ? Math.round((100 - remaining + typed) * 100) / 100 : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (weightError) return;
    let extra = {};
    if (detailed) {
      const result = detailedBody(dForm);
      if (result.error) {
        setLocalError(result.error);
        return;
      }
      extra = { ...result.body, instrument: instrument || null };
    }
    setLocalError(null);
    try {
      await run({
        title: form.title,
        category: form.category,
        weightPercent: Number(form.weightPercent),
        description: form.description.trim(),
        plannedDate: form.plannedDate,
        ...(plan.subject_id ? { programmaticContentId: contentId || null } : {}),
        ...extra,
      });
      toast.success(isEdit ? 'Actividad actualizada' : 'Actividad creada', form.title);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal (incluye el 422 si excede 100%)
    }
  };

  return (
    <Drawer title={isEdit ? 'Editar actividad' : 'Nueva actividad'} onClose={onClose} size={detailed ? 'lg' : undefined}>
      <Alert>{localError || error}</Alert>
      <div className="activity-term">
        <span className="student-card__label">Lapso académico</span>
        <TermBadge number={plan.term_number} name={plan.term_name} />
        <span className="text-sm text-muted">
          {plan.subject} · la nota de esta actividad cuenta para el {termLabel(plan.term_number, plan.term_name)}
        </span>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label={detailed ? 'Actividad o instrumento' : 'Título'} error={fieldErrors.title} full>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </Field>
          {plan.subject_id && (
            <Field
              label="Tema del contenido programático"
              error={fieldErrors.programmaticContentId}
              full
              hint={content && content.units.length === 0 ? 'Esta materia aún no tiene contenido programático en este grado.' : 'Opcional: el tema que evalúa la actividad.'}
            >
              <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
                <option value="">Sin tema</option>
                {(content?.units || []).map((u) => (
                  <optgroup key={u.unit} label={u.unit}>
                    {u.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.topic}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Tipo" error={fieldErrors.category} hint={initial.project ? 'Es el proyecto pedagógico de aula: su tipo es siempre Proyecto.' : undefined}>
            <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} disabled={Boolean(initial.project)}>
              <option value="formative">Formativa</option>
              <option value="exam">Examen</option>
              <option value="project">Proyecto</option>
              <option value="homework">Tarea</option>
              <option value="other">Otra</option>
            </Select>
          </Field>
          <Field
            label="Porcentaje de la nota"
            error={weightError || fieldErrors.weightPercent}
            hint={
              afterSave !== null
                ? `Disponible: ${remaining}% · el plan quedará en ${afterSave}%${afterSave === 100 ? ' ✓' : ''}`
                : `Disponible en este plan: ${remaining}%`
            }
          >
            <Input
              suffix="%"
              error={weightError || fieldErrors.weightPercent}
              className={afterSave === 100 ? 'input--success' : ''}
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={form.weightPercent}
              onChange={(e) => setForm((f) => ({ ...f, weightPercent: e.target.value }))}
              required
            />
          </Field>
          <Field
            label="Fecha estimada"
            error={fieldErrors.plannedDate}
            hint={termStart && termEnd ? `Dentro del lapso: ${formatDay(termStart)} – ${formatDay(termEnd)}` : 'Opcional.'}
          >
            <Input
              type="date"
              value={form.plannedDate}
              min={termStart || undefined}
              max={termEnd || undefined}
              onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))}
            />
          </Field>
          <Field label="Descripción" error={fieldErrors.description} hint="Opcional: contenidos, criterios o instrucciones." full>
            <textarea
              className="input"
              rows={3}
              maxLength={1000}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ej.: Evaluación escrita de los temas 1 al 3. Se evalúa ortografía y comprensión."
            />
          </Field>
          {detailed && (
            <>
              <Field label="Instrumento de evaluación" error={fieldErrors.instrument} hint="Opcional.">
                <Select value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                  <option value="">Sin especificar</option>
                  {Object.entries(INSTRUMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Estrategia evaluativa" error={fieldErrors.strategy} hint="Ej.: Actividad evaluativa individual, trabajo en parejas…">
                <Input value={dForm.strategy} onChange={(e) => setDForm((f) => ({ ...f, strategy: e.target.value }))} maxLength={200} />
              </Field>
              <Field label="Puntaje de la actividad" error={fieldErrors.maxScore} hint="Los indicadores deben sumar este puntaje (ej. 20).">
                <Input
                  inputMode="decimal"
                  value={dForm.maxScore}
                  onChange={(e) => setDForm((f) => ({ ...f, maxScore: e.target.value }))}
                  suffix="pts"
                  disabled={locked}
                  required
                />
              </Field>
              <Field label="Referencias teórico-prácticas" full hint="Temas y subtemas que evalúa la actividad.">
                <ContentRefsEditor value={dForm.contentRefs} onChange={(contentRefs) => setDForm((f) => ({ ...f, contentRefs }))} />
              </Field>
              <Field label="Criterios e indicadores" error={fieldErrors.criteria} full>
                <CriteriaEditor value={dForm.criteria} onChange={(criteria) => setDForm((f) => ({ ...f, criteria }))} maxScore={dForm.maxScore} locked={locked} />
              </Field>
              <Field label="Fechas de aplicación" error={fieldErrors.sectionDates} full hint={termStart && termEnd ? `Dentro del lapso: ${formatDay(termStart)} – ${formatDay(termEnd)}` : undefined}>
                <div className="section-dates">
                  {plan.sections.map((sec) => (
                    <label key={sec.id} className="section-dates__item">
                      <span>Sección {sec.name}</span>
                      <Input
                        type="date"
                        value={dForm.sectionDates[sec.id] || ''}
                        min={termStart || undefined}
                        max={termEnd || undefined}
                        onChange={(e) => setDForm((f) => ({ ...f, sectionDates: { ...f.sectionDates, [sec.id]: e.target.value } }))}
                        aria-label={`Fecha de aplicación en la sección ${sec.name}`}
                      />
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={Boolean(weightError)}>
            Guardar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/**
 * Proyecto pedagógico de aula como actividad del plan: título, descripción,
 * ponderación (suma al 100% del lapso), fecha y competencias esperadas.
 * Con `existing` (proyecto anterior a la integración) solo se le asigna la
 * ponderación y la fecha: conserva su título y sus competencias.
 */
function ProjectFormModal({ planId, plan, existing, remaining, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', weightPercent: '', plannedDate: '' });
  const [competencies, setCompetencies] = useState(['']);
  const { run, loading, error, fieldErrors } = useMutation((data) => evaluationPlansApi.createProject(planId, data));
  const toast = useToast();

  const typed = form.weightPercent === '' ? null : Number(form.weightPercent);
  const weightError =
    typed === null ? null : !(typed > 0) ? 'Debe ser mayor que 0.' : typed > remaining ? `Excede lo disponible en el plan (${remaining}%).` : null;
  const afterSave = typed && !weightError ? Math.round((100 - remaining + typed) * 100) / 100 : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (weightError || !typed) return;
    try {
      await run({
        ...(existing ? {} : { title: form.title.trim(), description: form.description.trim() }),
        weightPercent: typed,
        plannedDate: form.plannedDate,
        competencies: existing ? [] : competencies.map((c) => c.trim()).filter(Boolean),
      });
      toast.success(existing ? 'Ponderación asignada' : 'Proyecto agregado al plan', `${existing?.title || form.title.trim()} · ${typed}%`);
      onCreated();
      onClose();
    } catch {
      // error visible en el modal (incluye el 422 si excede el 100%)
    }
  };

  return (
    <Drawer title={existing ? 'Ponderar proyecto pedagógico' : 'Proyecto pedagógico de aula'} onClose={onClose}>
      <p className="text-sm text-muted" style={{ marginTop: -6 }}>
        El proyecto se agrega como una actividad del {termLabel(plan.term_number, plan.term_name)}: su ponderación suma al 100% del plan y su nota cuenta
        en el acumulado y en la nota definitiva de {plan.subject}. Las competencias se evalúan además de forma cualitativa.
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          {existing ? (
            <Field label="Proyecto" full>
              <div className="project-chip">
                <Icon name="sparkles" size={14} /> {existing.title}
                <span className="text-muted"> · {existing.competencies.length} competencia(s)</span>
              </div>
            </Field>
          ) : (
            <>
              <Field label="Título del proyecto" error={fieldErrors.title} required full>
                <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} required autoFocus />
              </Field>
              <Field label="Descripción" error={fieldErrors.description} full hint="Opcional.">
                <textarea className="input" rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </Field>
            </>
          )}
          <Field
            label="Ponderación"
            required
            error={weightError || fieldErrors.weightPercent}
            hint={afterSave !== null ? `Disponible: ${remaining}% · el plan quedará en ${afterSave}%${afterSave === 100 ? ' ✓' : ''}` : `Disponible en este plan: ${remaining}%`}
          >
            <Input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              suffix="%"
              value={form.weightPercent}
              onChange={(e) => setForm((f) => ({ ...f, weightPercent: e.target.value }))}
              error={weightError}
              className={afterSave === 100 ? 'input--success' : ''}
              required
            />
          </Field>
          <Field
            label="Fecha estimada"
            error={fieldErrors.plannedDate}
            hint={plan.term_start && plan.term_end ? `Dentro del lapso: ${formatDay(plan.term_start)} – ${formatDay(plan.term_end)}` : 'Opcional.'}
          >
            <Input
              type="date"
              value={form.plannedDate}
              min={plan.term_start || undefined}
              max={plan.term_end || undefined}
              onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))}
            />
          </Field>
          {!existing && (
            <Field label="Competencias esperadas" full hint="Se evalúan de forma cualitativa (logrado / en proceso) en Calificaciones.">
              <div className="nested-editor">
                {competencies.map((c, i) => (
                  <div key={i} className="nested-editor__row">
                    <Input
                      value={c}
                      onChange={(e) => setCompetencies((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder={`Competencia ${i + 1}`}
                      aria-label={`Competencia ${i + 1}`}
                    />
                    {competencies.length > 1 && (
                      <button
                        type="button"
                        className="row-action row-action--delete"
                        onClick={() => setCompetencies((list) => list.filter((_, j) => j !== i))}
                        aria-label="Quitar competencia"
                        title="Quitar competencia"
                      >
                        <Icon name="x" size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" icon="plus" onClick={() => setCompetencies((l) => [...l, ''])}>
                  Agregar competencia
                </Button>
              </div>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!typed || Boolean(weightError) || (!existing && !form.title.trim())}>
            {existing ? 'Asignar ponderación' : 'Agregar al plan'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

/** Dentro de la fila de la actividad: distintivo del proyecto y sus competencias (se pueden agregar más). */
function ProjectBlock({ project, canEdit, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const { run, loading, error } = useMutation((data) => evaluationPlansApi.addCompetency(project.id, data));
  const { can } = useAuth();

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await run({ description: description.trim() });
      setDescription('');
      setAdding(false);
      onChanged();
    } catch {
      // error visible abajo
    }
  };

  return (
    <div className="project-block">
      <span className="project-chip">
        <Icon name="sparkles" size={13} /> Proyecto pedagógico de aula
      </span>
      {project.competencies.length > 0 ? (
        <ul className="project-block__list">
          {project.competencies.map((c) => (
            <li key={c.id}>{c.description}</li>
          ))}
        </ul>
      ) : (
        <div className="cell-person__sub">Sin competencias definidas.</div>
      )}
      <Alert>{error}</Alert>
      {adding ? (
        <form onSubmit={handleAdd} className="project-block__form">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Nueva competencia" aria-label="Nueva competencia" required autoFocus />
          <Button type="submit" size="sm" loading={loading}>
            Agregar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        canEdit &&
        can('evaluation_plans', 'update') && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>
            Competencia
          </Button>
        )
      )}
    </div>
  );
}

export default EvaluationPlanDetailPage;
