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
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { LevelBadge, STAFF_ROLES } from '../levels';
import TeacherAssignmentModal from '../components/TeacherAssignmentModal';

/**
 * Personal docente de la sección (según su nivel) y las materias que ve con su
 * docente, en solo lectura: las materias se gestionan en el módulo de Materias.
 */
function SectionTeachersCard({ sectionId, onAssign }) {
  const { data, loading, error } = useFetch(() => academicsApi.getSectionTeachers(sectionId), [sectionId]);

  let body;
  if (loading) body = <Spinner label={null} />;
  else if (error) body = <Alert>{error}</Alert>;
  else {
    const roles = STAFF_ROLES[data.section.level_code] || [];
    const current = { lead: data.homeroom?.lead, assistant: data.homeroom?.assistant, guide: data.guide };
    body = (
      <>
        <dl className="detail-list">
          {roles.map((r) => (
            <div key={r.key} className="detail-list__item">
              <dt>{r.label}</dt>
              <dd>{current[r.key] ? current[r.key].name : <span className="teacher-stack__missing">Sin asignar</span>}</dd>
            </div>
          ))}
        </dl>
        {data.section.has_curriculum && (
          <div className="section-subjects">
            <div className="section-subjects__head">
              <strong>Materias</strong>
              <Link to={`/academics/subjects?grado=${data.section.grade_id}`} className="text-sm">
                Gestionar en Materias
              </Link>
            </div>
            {data.subjects.length === 0 ? (
              <p className="text-muted text-sm">Esta sección aún no tiene materias.</p>
            ) : (
              <ul className="assignment-list">
                {data.subjects.map((s) => (
                  <li key={s.id}>
                    <strong>{s.name}</strong>
                    {s.effectiveTeacher ? (
                      <span>
                        {s.effectiveTeacher.name}
                        {s.inherited && <span className="text-muted"> · docente de aula</span>}
                      </span>
                    ) : (
                      <span className="teacher-stack__missing">Sin docente</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <Card
      title="Personal docente"
      actions={
        <RequirePermission module="academics" action="update">
          <Button size="sm" variant="secondary" icon="users" onClick={onAssign}>
            Asignar personal
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
  const { data: students = [], loading: loadingStudents } = useFetch(
    () => studentsApi.list({ status: 'active', availableFor: sectionId }),
    [sectionId]
  );
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const { run, loading, error } = useMutation(academicsApi.enrollBulk);

  const filtered = (students ?? []).filter((s) => {
    const q = search.trim().toLowerCase();
    return !q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q);
  });

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.id)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected.size) return;
    try {
      await run({ studentIds: [...selected], sectionId });
      onEnrolled();
      onClose();
    } catch {
      // error visible en el modal (ej. cupo insuficiente)
    }
  };

  const allChecked = filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  return (
    <Modal title="Inscribir alumnos" onClose={onClose}>
      <Alert>{error}</Alert>
      {loadingStudents ? (
        <Spinner />
      ) : students.length === 0 ? (
        <p style={{ margin: '0 0 16px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>
          No hay alumnos disponibles para inscribir en este año escolar.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-field" style={{ marginBottom: '12px' }}>
            <input
              className="form-field__input"
              type="search"
              placeholder="Buscar alumno…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              maxHeight: '280px',
              overflowY: 'auto',
              marginBottom: '8px',
            }}
          >
            {/* Cabecera: seleccionar todos los filtrados */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                borderBottom: '1px solid var(--color-border)',
                background: 'var(--color-surface-raised)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600,
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                style={{ cursor: 'pointer' }}
              />
              Seleccionar todos ({filtered.length})
            </label>

            {filtered.length === 0 ? (
              <p style={{ margin: '12px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                Sin resultados para «{search}»
              </p>
            ) : (
              filtered.map((s) => (
                <label
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    background: selected.has(s.id) ? 'var(--color-primary-soft)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span>
                    {s.last_name}, {s.first_name}
                    {s.national_id && (
                      <span style={{ color: 'var(--color-text-secondary)', marginLeft: '6px', fontSize: '13px' }}>
                        {s.national_id}
                      </span>
                    )}
                  </span>
                </label>
              ))
            )}
          </div>

          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {selected.size === 0
              ? 'Ningún alumno seleccionado'
              : `${selected.size} alumno${selected.size !== 1 ? 's' : ''} seleccionado${selected.size !== 1 ? 's' : ''}`}
          </p>

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={selected.size === 0}>
              Inscribir {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default SectionDetailPage;
