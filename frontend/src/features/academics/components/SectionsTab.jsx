import { useState } from 'react';
import { Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import staffApi from '../../../api/endpoints/staff.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';

function SectionsTab() {
  const { data: sections, loading, error, refetch } = useFetch(() => academicsApi.listSections(), []);
  const [showCreate, setShowCreate] = useState(false);

  const columns = [
    {
      key: 'name',
      header: 'Sección',
      render: (s) => <Link to={`/academics/sections/${s.id}`}>{s.grade_name} - {s.name}</Link>,
    },
    { key: 'max_students', header: 'Cupo máximo' },
  ];

  return (
    <div>
      <div className="card">
        <div className="card__header">
          <h3 className="card__title">Secciones</h3>
          <RequirePermission module="academics" action="create">
            <Button size="sm" onClick={() => setShowCreate(true)}>
              + Nueva sección
            </Button>
          </RequirePermission>
        </div>
        <Alert>{error}</Alert>
        {loading ? <Spinner /> : <Table columns={columns} rows={sections} emptyMessage="Aún no hay secciones creadas." />}
      </div>

      {showCreate && <CreateSectionModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
    </div>
  );
}

function CreateSectionModal({ onClose, onCreated }) {
  const { data: grades, loading: loadingGrades } = useFetch(() => academicsApi.listGrades(), []);
  const { data: periods, loading: loadingPeriods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const { data: classrooms, loading: loadingClassrooms } = useFetch(() => academicsApi.listClassrooms(), []);
  const { data: teachers, loading: loadingTeachers } = useFetch(() => staffApi.list({ staffType: 'teaching' }), []);

  const [form, setForm] = useState({
    gradeId: '',
    schoolPeriodId: '',
    classroomId: '',
    name: '',
    maxStudents: 30,
    leadTeacherId: '',
    assistantTeacherId: '',
  });
  const { run, loading, error, fieldErrors } = useMutation(academicsApi.createSection);

  const loadingOptions = loadingGrades || loadingPeriods || loadingClassrooms || loadingTeachers;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({
        gradeId: form.gradeId,
        schoolPeriodId: form.schoolPeriodId,
        classroomId: form.classroomId || undefined,
        name: form.name,
        maxStudents: Number(form.maxStudents),
        leadTeacherId: form.leadTeacherId || undefined,
        assistantTeacherId: form.assistantTeacherId || undefined,
      });
      onCreated();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Nueva sección" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingOptions ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Grado" error={fieldErrors.gradeId}>
              <Select value={form.gradeId} onChange={(e) => setForm((f) => ({ ...f, gradeId: e.target.value }))} required>
                <option value="">Selecciona…</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Año escolar" error={fieldErrors.schoolPeriodId}>
              <Select value={form.schoolPeriodId} onChange={(e) => setForm((f) => ({ ...f, schoolPeriodId: e.target.value }))} required>
                <option value="">Selecciona…</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Nombre de la sección" error={fieldErrors.name}>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="A" required />
            </Field>
            <Field label="Cupo máximo" error={fieldErrors.maxStudents}>
              <Input type="number" min="1" value={form.maxStudents} onChange={(e) => setForm((f) => ({ ...f, maxStudents: e.target.value }))} required />
            </Field>
            <Field label="Aula física">
              <Select value={form.classroomId} onChange={(e) => setForm((f) => ({ ...f, classroomId: e.target.value }))}>
                <option value="">Sin asignar</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Docente titular">
              <Select value={form.leadTeacherId} onChange={(e) => setForm((f) => ({ ...f, leadTeacherId: e.target.value }))}>
                <option value="">Sin asignar</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Docente auxiliar" error={fieldErrors.assistantTeacherId}>
              <Select value={form.assistantTeacherId} onChange={(e) => setForm((f) => ({ ...f, assistantTeacherId: e.target.value }))}>
                <option value="">Sin asignar</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                ))}
              </Select>
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

export default SectionsTab;
