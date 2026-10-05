import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
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
      title: '¿Eliminar esta actividad?',
      message: `"${activity.title}" (${Number(activity.weight_percent)}%) se quitará del plan y su porcentaje quedará disponible.`,
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
          {a.description && <div className="cell-person__sub activity-description">{a.description}</div>}
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
  const remaining = Math.max(0, 100 - totalWeight);
  const meterState = totalWeight > 100 ? 'over' : totalWeight === 100 ? 'complete' : 'partial';

  return (
    <div>
      <PageHeader
        title={plan.subject}
        subtitle={
          <span className="page-header__meta">
            {FORMATS[plan.format]?.label || 'Plan de evaluación'} · {plan.grade_name} {plan.sections.map((sec) => sec.name).join(', ')} · {plan.term_name}
            {plan.term_start && plan.term_end && ` (${formatDay(plan.term_start)} – ${formatDay(plan.term_end)})`}
            {closed ? <Badge variant="success">Cerrado</Badge> : <Badge variant="info">Abierto</Badge>}
          </span>
        }
        actions={
          <>
            <Link to={`/grading/plans/${id}`} className="btn btn--secondary">
              Ver calificaciones
            </Link>
            <Link to="/evaluation-plans" className="btn btn--secondary">
              Volver
            </Link>
          </>
        }
      />

      <Card title="Configuración del plan" subtitle="Tipo de formato y secciones a las que se aplica">
        <PlanSettings plan={plan} canEdit={can('evaluation_plans', 'update')} onChanged={refetch} />
      </Card>

      <Card
        title="Total acumulado del lapso"
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
        title="Actividades de evaluación"
        actions={
          <RequirePermission module="evaluation_plans" action="create">
            {!closed && (
              <Button
                size="sm"
                icon="plus"
                onClick={() => setActivityModal({})}
                disabled={remaining <= 0}
                title={remaining <= 0 ? 'El plan ya suma 100%' : undefined}
              >
                Nueva actividad
              </Button>
            )}
          </RequirePermission>
        }
      >
        <Alert>{deleteError}</Alert>
        {plan.format === 'detailed' ? (
          <PlannerTable
            activities={plan.activities}
            sections={plan.sections}
            categoryLabels={CATEGORY_LABELS}
            renderActions={closed ? null : (a) => activityColumns.find((c) => c.key === 'actions').render(a)}
          />
        ) : (
          <Table columns={activityColumns} rows={plan.activities} emptyMessage="Aún no hay actividades en este plan." />
        )}
      </Card>

      <Card
        title="Proyecto pedagógico de aula"
        actions={
          !plan.pedagogicalProject && (
            <RequirePermission module="evaluation_plans" action="create">
              <Button size="sm" onClick={() => setShowProjectForm(true)}>
                + Crear proyecto
              </Button>
            </RequirePermission>
          )
        }
      >
        {plan.pedagogicalProject ? (
          <ProjectView project={plan.pedagogicalProject} onChanged={refetch} />
        ) : (
          <p className="text-muted">Este plan no tiene proyecto pedagógico (es opcional).</p>
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
        <ProjectFormModal planId={id} onClose={() => setShowProjectForm(false)} onCreated={refetch} />
      )}
    </div>
  );
}

function ActivityFormModal({ plan, planId, initial, remaining, termStart, termEnd, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
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
      extra = result.body;
    }
    setLocalError(null);
    try {
      await run({
        title: form.title,
        category: form.category,
        weightPercent: Number(form.weightPercent),
        description: form.description.trim(),
        plannedDate: form.plannedDate,
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
    <Modal title={isEdit ? 'Editar actividad' : 'Nueva actividad'} onClose={onClose} size={detailed ? 'lg' : undefined}>
      <Alert>{localError || error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label={detailed ? 'Actividad o instrumento' : 'Título'} error={fieldErrors.title} full>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
          </Field>
          <Field label="Tipo" error={fieldErrors.category}>
            <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
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
    </Modal>
  );
}

function ProjectFormModal({ planId, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '' });
  const [competencies, setCompetencies] = useState(['']);
  const { run, loading, error, fieldErrors } = useMutation((data) => evaluationPlansApi.createProject(planId, data));

  const updateCompetency = (index, value) => {
    setCompetencies((list) => list.map((c, i) => (i === index ? value : c)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ ...form, competencies: competencies.map((c) => c.trim()).filter(Boolean) });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Nuevo proyecto pedagógico" onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Título" error={fieldErrors.title}>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Descripción" error={fieldErrors.description}>
          <textarea
            className="input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Competencias esperadas">
          {competencies.map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input value={c} onChange={(e) => updateCompetency(i, e.target.value)} placeholder={`Competencia ${i + 1}`} />
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setCompetencies((l) => [...l, ''])}>
            + Agregar competencia
          </Button>
        </Field>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Crear proyecto
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectView({ project, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const { run, loading, error } = useMutation((data) => evaluationPlansApi.addCompetency(project.id, data));

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      await run({ description });
      setDescription('');
      setAdding(false);
      onChanged();
    } catch {
      // error visible abajo
    }
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 4px' }}>{project.title}</h4>
      {project.description && <p>{project.description}</p>}

      <ul style={{ paddingLeft: 18 }}>
        {project.competencies.map((c) => (
          <li key={c.id}>{c.description}</li>
        ))}
      </ul>

      <Alert>{error}</Alert>

      {adding ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Nueva competencia" required />
          <Button type="submit" size="sm" loading={loading}>
            Agregar
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(false)}>
            Cancelar
          </Button>
        </form>
      ) : (
        <RequirePermission module="evaluation_plans" action="update">
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            + Agregar competencia
          </Button>
        </RequirePermission>
      )}
    </div>
  );
}

export default EvaluationPlanDetailPage;
