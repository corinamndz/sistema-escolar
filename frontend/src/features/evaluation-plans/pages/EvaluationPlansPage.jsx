import { useState } from 'react';
import { Link } from 'react-router-dom';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import academicsApi from '../../../api/endpoints/academics.api';
import staffApi from '../../../api/endpoints/staff.api';
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

function EvaluationPlansPage() {
  const { data: periods, loading: loadingPeriods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [schoolPeriodId, setSchoolPeriodId] = useState('');

  const { data: terms, loading: loadingTerms, refetch: refetchTerms } = useFetch(
    () => (schoolPeriodId ? evaluationPlansApi.listTerms(schoolPeriodId) : Promise.resolve([])),
    [schoolPeriodId]
  );
  const { data: plans, loading: loadingPlans, refetch: refetchPlans } = useFetch(() => evaluationPlansApi.list(), []);

  const [showCreateTerm, setShowCreateTerm] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);

  const planColumns = [
    { key: 'subject', header: 'Asignatura', render: (p) => <Link to={`/evaluation-plans/${p.id}`}>{p.subject}</Link> },
    { key: 'section_name', header: 'Sección' },
    { key: 'term_name', header: 'Lapso' },
  ];

  return (
    <div>
      <PageHeader title="Planes de evaluación" subtitle="Lapsos, planes y actividades por sección" />

      <div className="grid grid--2">
        <Card
          title="Lapsos"
          actions={
            <RequirePermission module="evaluation_plans" action="create">
              <Button size="sm" onClick={() => setShowCreateTerm(true)} disabled={!schoolPeriodId}>
                + Nuevo lapso
              </Button>
            </RequirePermission>
          }
        >
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label>Año escolar</label>
            <Select value={schoolPeriodId} onChange={(e) => setSchoolPeriodId(e.target.value)} disabled={loadingPeriods}>
              <option value="">Selecciona un año escolar…</option>
              {periods?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          {schoolPeriodId ? (
            loadingTerms ? <Spinner /> : (
              <ul style={{ paddingLeft: 18 }}>
                {(terms || []).map((t) => (
                  <li key={t.id}>{t.name}</li>
                ))}
                {terms?.length === 0 && <p className="text-muted">Sin lapsos para este año escolar.</p>}
              </ul>
            )
          ) : (
            <p className="text-muted">Elige un año escolar para ver o crear sus lapsos.</p>
          )}
        </Card>

        <Card
          title="Planes de evaluación"
          actions={
            <RequirePermission module="evaluation_plans" action="create">
              <Button size="sm" onClick={() => setShowCreatePlan(true)}>
                + Nuevo plan
              </Button>
            </RequirePermission>
          }
        >
          {loadingPlans ? <Spinner /> : <Table columns={planColumns} rows={plans} emptyMessage="Aún no hay planes de evaluación." />}
        </Card>
      </div>

      {showCreateTerm && (
        <CreateTermModal
          schoolPeriodId={schoolPeriodId}
          onClose={() => setShowCreateTerm(false)}
          onCreated={refetchTerms}
        />
      )}

      {showCreatePlan && (
        <CreatePlanModal onClose={() => setShowCreatePlan(false)} onCreated={refetchPlans} />
      )}
    </div>
  );
}

function CreateTermModal({ schoolPeriodId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const { run, loading, error, fieldErrors } = useMutation(evaluationPlansApi.createTerm);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ schoolPeriodId, ...form });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Nuevo lapso" onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <Field label="Nombre" error={fieldErrors.name}>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Lapso 1" required />
        </Field>
        <div style={{ height: 12 }} />
        <div className="form-grid">
          <Field label="Fecha de inicio">
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
          <Field label="Fecha de fin">
            <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Crear
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreatePlanModal({ onClose, onCreated }) {
  const { data: sections, loading: loadingSections } = useFetch(() => academicsApi.listSections(), []);
  const { data: teachers, loading: loadingTeachers } = useFetch(() => staffApi.list({ staffType: 'teaching' }), []);
  const [sectionId, setSectionId] = useState('');
  const { data: terms, loading: loadingTerms } = useFetch(() => {
    const section = sections?.find((s) => s.id === sectionId);
    return section ? evaluationPlansApi.listTerms(section.school_period_id) : Promise.resolve([]);
  }, [sectionId, sections]);

  const [form, setForm] = useState({ termId: '', teacherId: '', subject: '' });
  const { run, loading, error, fieldErrors } = useMutation(evaluationPlansApi.create);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ sectionId, termId: form.termId, teacherId: form.teacherId, subject: form.subject });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  const loadingOptions = loadingSections || loadingTeachers;

  return (
    <Modal title="Nuevo plan de evaluación" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingOptions ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Sección" error={fieldErrors.sectionId} full>
              <Select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setForm((f) => ({ ...f, termId: '' })); }} required>
                <option value="">Selecciona…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.grade_name} - {s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Lapso" error={fieldErrors.termId}>
              <Select value={form.termId} onChange={(e) => setForm((f) => ({ ...f, termId: e.target.value }))} disabled={!sectionId || loadingTerms} required>
                <option value="">{sectionId ? 'Selecciona…' : 'Elige una sección primero'}</option>
                {(terms || []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Docente" error={fieldErrors.teacherId}>
              <Select value={form.teacherId} onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))} required>
                <option value="">Selecciona…</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Asignatura" error={fieldErrors.subject}>
              <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Matemática" required />
            </Field>
          </div>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Crear
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default EvaluationPlansPage;
