import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LevelBadge } from '../levels';
import TeacherAssignmentModal from '../components/TeacherAssignmentModal';

/** Docentes de la sección, con la forma que corresponde a su nivel. */
function SectionTeachersCard({ sectionId, onAssign }) {
  const { data, loading, error } = useFetch(() => academicsApi.getSectionTeachers(sectionId), [sectionId]);

  let body;
  if (loading) body = <Spinner label={null} />;
  else if (error) body = <Alert>{error}</Alert>;
  else if (data.mode === 'homeroom') {
    const rows = [['Docente titular', data.homeroom.lead]];
    if (data.section.allows_assistant) rows.push(['Docente auxiliar', data.homeroom.assistant]);
    body = (
      <dl className="detail-list">
        {rows.map(([label, teacher]) => (
          <div key={label} className="detail-list__item">
            <dt>{label}</dt>
            <dd>{teacher ? teacher.name : <span className="teacher-stack__missing">Sin asignar</span>}</dd>
          </div>
        ))}
      </dl>
    );
  } else if (data.subjects.length === 0) {
    body = <p className="text-muted">El grado no tiene materias en su plan de estudios.</p>;
  } else {
    body = (
      <ul className="assignment-list">
        {data.subjects.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong>
            {s.teacher ? <span>{s.teacher.name}</span> : <span className="teacher-stack__missing">Sin profesor</span>}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card
      title="Docentes asignados"
      actions={
        <RequirePermission module="academics" action="update">
          <Button size="sm" variant="secondary" icon="users" onClick={onAssign}>
            Asignar docentes
          </Button>
        </RequirePermission>
      }
    >
      {body}
    </Card>
  );
}

function SectionDetailPage() {
  const { id } = useParams();
  const { data: section, loading: loadingSection, error, refetch } = useFetch(() => academicsApi.getSection(id), [id]);
  const { data: roster, loading: loadingRoster, refetch: refetchRoster } = useFetch(() => academicsApi.getRoster(id), [id]);
  const [assigning, setAssigning] = useState(false);
  const [teachersVersion, setTeachersVersion] = useState(0);
  const [showEnroll, setShowEnroll] = useState(false);
  const { run: withdrawRun, error: withdrawError } = useMutation(academicsApi.withdraw);

  const confirm = useConfirm();

  const handleWithdraw = async (enrollmentId) => {
    const ok = await confirm({
      title: '¿Retirar a este alumno de la sección?',
      message: 'Se liberará su cupo en la sección.',
      danger: true,
      confirmLabel: 'Retirar',
    });
    if (!ok) return;
    try {
      await withdrawRun(enrollmentId);
      refetchRoster();
      refetch();
    } catch {
      // error visible arriba
    }
  };

  if (loadingSection) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!section) return null;

  const rosterColumns = [
    { key: 'name', header: 'Alumno', render: (r) => <Link to={`/students/${r.student_id}`}>{r.first_name} {r.last_name}</Link> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <RequirePermission module="academics" action="update">
          <Button size="sm" variant="danger" onClick={() => handleWithdraw(r.enrollment_id)}>
            Retirar
          </Button>
        </RequirePermission>
      ),
    },
  ];

  const occupied = roster?.length || 0;

  return (
    <div>
      <PageHeader
        title={`${section.grade_name} · Sección ${section.name}`}
        subtitle={
          <span className="page-header__meta">
            <LevelBadge code={section.level_code} short={false} />
            Año escolar {section.school_period_name}
            {section.classroom_name && ` · Aula ${section.classroom_name}`}
          </span>
        }
        actions={
          <Link to="/academics" className="btn btn--secondary">
            Volver
          </Link>
        }
      />

      <div className="grid grid--2">
        <SectionTeachersCard key={teachersVersion} sectionId={id} onAssign={() => setAssigning(true)} />
        <Card title="Cupo">
          <div className="progress-bar">
            <div
              className="progress-bar__fill"
              style={{ width: `${Math.min(100, (occupied / section.max_students) * 100)}%` }}
            />
          </div>
          <p style={{ marginTop: 8 }}>{occupied} de {section.max_students} alumnos inscritos</p>
        </Card>
      </div>

      <Card
        title="Alumnos inscritos"
        actions={
          <RequirePermission module="academics" action="update">
            <Button size="sm" onClick={() => setShowEnroll(true)} disabled={occupied >= section.max_students}>
              + Inscribir alumno
            </Button>
          </RequirePermission>
        }
      >
        <Alert>{withdrawError}</Alert>
        {loadingRoster ? <Spinner /> : <Table columns={rosterColumns} rows={roster} emptyMessage="Sin alumnos inscritos." />}
      </Card>

      {assigning && (
        <TeacherAssignmentModal
          sectionId={id}
          onClose={() => setAssigning(false)}
          onSaved={() => setTeachersVersion((v) => v + 1)}
        />
      )}

      {showEnroll && (
        <EnrollModal
          sectionId={id}
          onClose={() => setShowEnroll(false)}
          onEnrolled={() => {
            refetchRoster();
            refetch();
          }}
        />
      )}
    </div>
  );
}

function EnrollModal({ sectionId, onClose, onEnrolled }) {
  const { data: students, loading: loadingStudents } = useFetch(() => studentsApi.list({ status: 'active' }), []);
  const [studentId, setStudentId] = useState('');
  const { run, loading, error } = useMutation(academicsApi.enroll);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ studentId, sectionId });
      onEnrolled();
      onClose();
    } catch {
      // error visible en el modal (ej. cupo lleno, ya inscrito)
    }
  };

  return (
    <Modal title="Inscribir alumno" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingStudents ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <Field label="Alumno">
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
              ))}
            </Select>
          </Field>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Inscribir
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default SectionDetailPage;
