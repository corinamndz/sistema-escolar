import { useState } from 'react';
import Switch from '../../../components/ui/Switch';
import { getErrorMessage } from '../../../api/axiosClient';
import { useNavigate } from 'react-router-dom';
import enrollmentFormsApi from '../../../api/endpoints/enrollmentForms.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { useAuth } from '../../../context/AuthContext';
import { canManageAdmissions } from '../../../components/layout/navigation';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { currentPeriod } from '../../../lib/schoolPeriods';
import { FORM_STATUS } from '../fieldTypes';

/**
 * Planillas de inscripción: el colegio diseña la planilla de cada año escolar,
 * la publica en el portal de los representantes y revisa las que recibe.
 */
/** «Habilitar como solicitud de cupo en la web pública» (una planilla por colegio). */
function PublicIntakeToggle({ form, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const toast = useToast();
  const change = async (enabled) => {
    setBusy(true);
    try {
      const r = await enrollmentFormsApi.setPublicIntake(form.id, enabled);
      setWarnings(r.warnings || []);
      toast.success(enabled ? 'Solicitud de cupo habilitada' : 'Solicitud de cupo retirada', enabled ? 'Se muestra en el sitio web del colegio (sin cuenta).' : 'Ya no se ofrece en el sitio web.');
      onChanged();
    } catch (err) {
      toast.error('No se pudo cambiar', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ef-web">
      <Switch
        checked={form.public_intake}
        onChange={change}
        disabled={busy}
        label="Habilitar como solicitud de cupo en la web pública"
        description="Cualquier visitante del sitio del colegio podrá llenarla sin cuenta. Llega a «Planillas recibidas» marcada como «Página web». Solo una planilla a la vez."
      />
      {form.public_intake && warnings.length > 0 && (
        <ul className="ef-web__warnings">
          {warnings.map((w) => (
            <li key={w}>
              <Icon name="alertTriangle" size={13} /> {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EnrollmentFormsPage() {
  const { data: forms, loading, error, refetch } = useFetch(() => enrollmentFormsApi.list(), []);
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Diseño de planillas"
        subtitle="Diseña la planilla que llenan las familias en el portal. Las que envían se revisan en «Planillas recibidas»."
        actions={
          canManageAdmissions(user) && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Nueva planilla
            </Button>
          )
        }
      />
      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : !forms?.length ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="clipboard" size={24} />
          </div>
          <div className="empty-state__title">Aún no hay planillas</div>
          <div className="text-sm">Crea la planilla de inscripción del próximo año escolar: parte de una plantilla base que puedes ajustar.</div>
        </div>
      ) : (
        <div className="ef-list">
          {forms.map((f) => (
            <div key={f.id} className={`ef-card-wrap ${f.public_intake ? 'is-web' : ''}`}>
            <button type="button" className="ef-card" onClick={() => navigate(`/enrollment-forms/${f.id}`)}>
              <span className="ef-card__icon">
                <Icon name="clipboard" size={20} />
              </span>
              <span className="ef-card__main">
                <strong>{f.title}</strong>
                <span className="ef-card__meta">
                  {f.school_period_name} · {f.question_count} pregunta{f.question_count === 1 ? '' : 's'}
                </span>
              </span>
              <span className="ef-card__stats">
                <span>
                  <strong>{f.submissions}</strong> recibida{f.submissions === 1 ? '' : 's'}
                </span>
                {f.pending > 0 && <span className="ef-card__pending">{f.pending} por revisar</span>}
              </span>
              {f.public_intake && <Badge variant="primary">En la web</Badge>}
              <Badge variant={FORM_STATUS[f.status].variant}>{FORM_STATUS[f.status].label}</Badge>
              <Icon name="chevronRight" size={18} className="ef-card__chevron" />
            </button>
            {/* Solicitud de cupo pública: abre una entrada SIN cuenta, por eso solo el Administrador. */}
            {user?.isAdmin && <PublicIntakeToggle form={f} onChanged={refetch} />}
            </div>
          ))}
        </div>
      )}
      {creating && (
        <CreateFormDrawer
          forms={forms || []}
          onClose={() => setCreating(false)}
          onCreated={(f) => {
            refetch();
            navigate(`/enrollment-forms/${f.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateFormDrawer({ forms, onClose, onCreated }) {
  const { data: periods, loading } = useFetch(() => enrollmentFormsApi.periods(), []);
  const [form, setForm] = useState({ schoolPeriodId: '', title: '', copyFromId: '' });
  const { run, loading: saving, error, fieldErrors } = useMutation(enrollmentFormsApi.create);
  const toast = useToast();
  // Por defecto: el año escolar más reciente abierto (normalmente el próximo, el que se inscribe).
  const periodId = form.schoolPeriodId || periods?.[0]?.id || currentPeriod(periods || [])?.id || '';
  const period = (periods || []).find((p) => p.id === periodId);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const created = await run({ schoolPeriodId: periodId, title: form.title.trim() || `Inscripción ${period?.name || ''}`.trim(), copyFromId: form.copyFromId || null });
      toast.success('Planilla creada', 'Ajusta sus campos y publícala cuando esté lista.');
      onCreated(created);
    } catch {
      // error visible
    }
  };

  return (
    <Drawer title="Nueva planilla de inscripción" icon="clipboard" onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : (
        <form onSubmit={submit}>
          <Alert>{error}</Alert>
          <div className="form-grid">
            <Field label="Año escolar" error={fieldErrors.schoolPeriodId} required full>
              <Select value={periodId} onChange={(e) => setForm((f) => ({ ...f, schoolPeriodId: e.target.value }))}>
                {(periods || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Título" error={fieldErrors.title} hint="Lo ven las familias en el portal." full>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={150} placeholder={`Inscripción ${period?.name || ''}`} />
            </Field>
            <Field label="Campos iniciales" full hint="Puedes cambiarlos todos después.">
              <Select value={form.copyFromId} onChange={(e) => setForm((f) => ({ ...f, copyFromId: e.target.value }))}>
                <option value="">Plantilla base (datos del alumno, salud, contacto de emergencia)</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    Copiar de «{f.title}» ({f.school_period_name})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!periodId}>
              Crear y diseñar
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

export default EnrollmentFormsPage;
