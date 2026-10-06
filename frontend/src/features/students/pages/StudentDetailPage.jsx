import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Table from '../../../components/ui/Table';
import Spinner from '../../../components/ui/Spinner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import Card from '../../../components/ui/Card';
import AcademicHistory from '../components/AcademicHistory';
import { useAuth } from '../../../context/AuthContext';

function StudentDetailPage() {
  const { id } = useParams();
  const { data: student, loading, error, refetch } = useFetch(() => studentsApi.getOne(id), [id]);
  const [showLink, setShowLink] = useState(false);
  const { run: unlinkRun, error: unlinkError } = useMutation((guardianId) => studentsApi.unlinkGuardian(id, guardianId));

  const confirm = useConfirm();
  const { user } = useAuth();

  const handleUnlink = async (guardianId) => {
    const ok = await confirm({
      title: '¿Quitar la asociación con este representante?',
      message: 'El representante seguirá registrado, pero ya no quedará vinculado a este alumno.',
      danger: true,
      confirmLabel: 'Quitar asociación',
    });
    if (!ok) return;
    try {
      await unlinkRun(guardianId);
      refetch();
    } catch {
      // error visible arriba
    }
  };

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!student) return null;

  const guardianColumns = [
    { key: 'name', header: 'Representante', render: (g) => `${g.first_name} ${g.last_name}` },
    { key: 'relationship', header: 'Relación', render: (g) => g.relationship || '—' },
    { key: 'is_primary', header: 'Principal', render: (g) => (g.is_primary ? 'Sí' : 'No') },
    { key: 'phone', header: 'Teléfono', render: (g) => g.phone || '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (g) => (
        <RequirePermission module="students" action="update">
          <Button size="sm" variant="danger" onClick={() => handleUnlink(g.id)}>
            Quitar
          </Button>
        </RequirePermission>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`${student.first_name} ${student.last_name}`}
        subtitle={student.national_id ? `Documento: ${student.national_id}` : undefined}
        actions={
          <Link to="/students" className="btn btn--secondary">
            Volver
          </Link>
        }
      />

      <div className="grid grid--2">
        <Card title="Inscripción actual">
          {student.currentEnrollment ? (
            <p>
              {user?.isRestrictedTeacher ? (
                `${student.currentEnrollment.grade_name} - Sección ${student.currentEnrollment.section_name}`
              ) : (
                <Link to={`/academics/sections/${student.currentEnrollment.section_id}`}>
                  {student.currentEnrollment.grade_name} - Sección {student.currentEnrollment.section_name}
                </Link>
              )}
            </p>
          ) : (
            <p>{user?.isRestrictedTeacher ? 'Sin inscripción activa.' : 'Sin inscripción activa. Ve a Académico → Secciones para inscribirlo.'}</p>
          )}
        </Card>

        <Card title="Datos generales">
          <p>Nacimiento: {student.birth_date ? student.birth_date.slice(0, 10) : '—'}</p>
          <p>Estado: {student.status}</p>
        </Card>
      </div>

      <Card title="Historial académico" subtitle="Años escolares cursados, resultado y boleta de cada año">
        <HistoryLoader studentId={id} />
      </Card>

      <Card
        title="Representantes"
        actions={
          <RequirePermission module="students" action="update">
            <Button size="sm" onClick={() => setShowLink(true)}>
              + Asociar representante
            </Button>
          </RequirePermission>
        }
      >
        <Alert>{unlinkError}</Alert>
        <Table columns={guardianColumns} rows={student.guardians} emptyMessage="Sin representantes asociados." />
      </Card>

      {showLink && (
        <LinkGuardianModal studentId={id} onClose={() => setShowLink(false)} onLinked={refetch} />
      )}
    </div>
  );
}

/** Carga y muestra el historial académico del alumno. */
function HistoryLoader({ studentId }) {
  const { data, loading, error } = useFetch(() => studentsApi.academicHistory(studentId), [studentId]);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return <AcademicHistory data={data} />;
}

/** Relaciones estándar alumno ↔ representante. Se guarda el texto tal cual (así se muestra en fichas y portal). */
const RELATIONSHIPS = ['Madre', 'Padre', 'Representante Legal', 'Tutor / Familiar', 'Otro'];

function LinkGuardianModal({ studentId, onClose, onLinked }) {
  const { data: guardians, loading: loadingGuardians } = useFetch(() => studentsApi.listGuardians(), []);
  const [form, setForm] = useState({ guardianId: '', relationship: '', otherRelationship: '', isPrimary: false });
  const { run, loading, error, fieldErrors } = useMutation((data) => studentsApi.linkGuardian(studentId, data));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // "Otro" puede precisarse (ej. "Abuela"); si no se especifica, se guarda "Otro".
    const relationship =
      form.relationship === 'Otro' && form.otherRelationship.trim() ? form.otherRelationship.trim() : form.relationship;
    try {
      await run({ guardianId: form.guardianId, relationship, isPrimary: form.isPrimary });
      onLinked();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title="Asociar representante" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingGuardians ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Representante">
            <Select
              sorted
              value={form.guardianId}
              onChange={(e) => setForm((f) => ({ ...f, guardianId: e.target.value }))}
              required
            >
              <option value="">Selecciona…</option>
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.first_name} {g.last_name}
                </option>
              ))}
            </Select>
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Relación con el alumno" error={fieldErrors.relationship} required>
            <Select
              value={form.relationship}
              onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
              required
            >
              <option value="">Selecciona…</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          {form.relationship === 'Otro' && (
            <>
              <div style={{ height: 12 }} />
              <Field label="Especifica la relación" hint="Opcional. Ej.: Abuela, Tía, Padrino.">
                <Input
                  value={form.otherRelationship}
                  onChange={(e) => setForm((f) => ({ ...f, otherRelationship: e.target.value }))}
                  maxLength={30}
                  placeholder="Otro"
                  autoFocus
                />
              </Field>
            </>
          )}
          <div style={{ height: 12 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
            />
            Es el representante principal
          </label>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Asociar
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default StudentDetailPage;
