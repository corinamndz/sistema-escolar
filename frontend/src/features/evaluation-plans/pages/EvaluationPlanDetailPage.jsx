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

const CATEGORY_LABELS = {
  formative: 'Formativa',
  exam: 'Examen',
  project: 'Proyecto',
  homework: 'Tarea',
  other: 'Otra',
};

function EvaluationPlanDetailPage() {
  const { id } = useParams();
  const { data: plan, loading, error, refetch } = useFetch(() => evaluationPlansApi.getOne(id), [id]);
  const [activityModal, setActivityModal] = useState(null); // null | {} (crear) | {...} (editar)
  const [showProjectForm, setShowProjectForm] = useState(false);
  const { run: deleteRun, error: deleteError } = useMutation((activityId) => evaluationPlansApi.deleteActivity(id, activityId));
  const confirm = useConfirm();
  const toast = useToast();

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

  const activityColumns = [
    { key: 'title', header: 'Actividad' },
    { key: 'category', header: 'Tipo', render: (a) => <Badge variant="primary">{CATEGORY_LABELS[a.category] || a.category}</Badge> },
    { key: 'weight_percent', header: '% de la nota', render: (a) => `${Number(a.weight_percent)}%` },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (a) => (
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
        subtitle="Plan de evaluación"
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

      <Card title="Sumatoria de porcentajes" subtitle="El plan debe sumar exactamente 100% de la nota">
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
              ? `Queda ${remaining}% disponible para nuevas actividades.`
              : 'El plan ya suma 100%, no se pueden agregar más actividades.'}
          </div>
        </div>
      </Card>

      <Card
        title="Actividades de evaluación"
        actions={
          <RequirePermission module="evaluation_plans" action="create">
            <Button size="sm" icon="plus" onClick={() => setActivityModal({})} disabled={remaining <= 0}>
              Nueva actividad
            </Button>
          </RequirePermission>
        }
      >
        <Alert>{deleteError}</Alert>
        <Table columns={activityColumns} rows={plan.activities} emptyMessage="Aún no hay actividades en este plan." />
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
          planId={id}
          initial={activityModal}
          remaining={remaining + (activityModal.weight_percent ? Number(activityModal.weight_percent) : 0)}
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

function ActivityFormModal({ planId, initial, remaining, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    title: initial.title || '',
    category: initial.category || 'formative',
    weightPercent: initial.weight_percent || '',
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
        : typed > remaining
          ? `Excede lo disponible: el plan quedaría en ${Math.round((100 - remaining + typed) * 100) / 100}%.`
          : null;
  const afterSave = typed && !weightError ? Math.round((100 - remaining + typed) * 100) / 100 : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (weightError) return;
    try {
      await run({ title: form.title, category: form.category, weightPercent: Number(form.weightPercent) });
      toast.success(isEdit ? 'Actividad actualizada' : 'Actividad creada', form.title);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal (incluye el 422 si excede 100%)
    }
  };

  return (
    <Modal title={isEdit ? 'Editar actividad' : 'Nueva actividad'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Título" error={fieldErrors.title} full>
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
