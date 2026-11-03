import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import academicsApi from '../../../api/endpoints/academics.api';
import studentsApi from '../../../api/endpoints/students.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
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

const initialsOf = (r) => `${r.first_name?.[0] || ''}${r.last_name?.[0] || ''}`.toUpperCase();

/**
 * Panel derecho del detalle: el cupo (compacto) y los alumnos inscritos en una
 * lista con scroll propio, que toma el alto de la columna izquierda (personal
 * docente y materias). Con muchos alumnos aparece un buscador.
 */
function SectionRosterPanel({ section, roster, loading, error, onEnroll, onWithdraw }) {
  const [query, setQuery] = useState('');
  const occupied = roster?.length || 0;
  const capacity = section.max_students || 0;
  const free = Math.max(0, capacity - occupied);
  const pct = capacity ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const tone = occupied >= capacity ? 'is-full' : pct >= 90 ? 'is-high' : '';
  const q = query.trim().toLowerCase();
  const rows = (roster || []).filter((r) => !q || `${r.first_name} ${r.last_name}`.toLowerCase().includes(q));

  return (
    <Card
      className="section-roster"
      title={
        <>
          Alumnos inscritos <span className="data-table__count">{occupied}</span>
        </>
      }
      actions={
        <RequirePermission module="academics" action="update">
          <Button size="sm" icon="plus" onClick={onEnroll} disabled={occupied >= capacity} title={occupied >= capacity ? 'La sección no tiene cupos libres' : undefined}>
            Inscribir
          </Button>
        </RequirePermission>
      }
    >
      {/* Cupo */}
      <div className={`section-capacity ${tone}`}>
        <div className="section-capacity__numbers">
          <span>
            <strong>{occupied}</strong> de {capacity} alumnos
          </span>
          <span className="section-capacity__free">{free === 0 ? 'Sin cupos libres' : `${free} ${free === 1 ? 'cupo libre' : 'cupos libres'}`}</span>
        </div>
        <div className="progress-bar" role="progressbar" aria-valuenow={occupied} aria-valuemin={0} aria-valuemax={capacity} aria-label="Cupo de la sección">
          <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <Alert>{error}</Alert>
      {occupied > 8 && (
        <div className="input-group section-roster__search">
          <Icon name="search" size={16} className="input-group__icon" />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar alumno…" aria-label="Buscar alumno inscrito" />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : occupied === 0 ? (
        <div className="section-roster__empty">
          <Icon name="users" size={22} />
          <span>Aún no hay alumnos inscritos.</span>
        </div>
      ) : (
        <ul className="section-roster__list">
          {rows.map((r) => (
            <li key={r.enrollment_id} className="section-roster__item">
              <span className="avatar avatar--sm">{initialsOf(r)}</span>
              <Link to={`/students/${r.student_id}`} className="section-roster__name">
                {r.last_name}, {r.first_name}
              </Link>
              <RequirePermission module="academics" action="update">
                <button type="button" className="row-action row-action--delete" onClick={() => onWithdraw(r.enrollment_id)} title="Retirar de la sección" aria-label={`Retirar a ${r.first_name} ${r.last_name}`}>
                  <Icon name="logout" size={15} />
                </button>
              </RequirePermission>
            </li>
          ))}
          {rows.length === 0 && <li className="section-roster__none text-sm text-muted">Ningún alumno coincide con «{query}».</li>}
        </ul>
      )}
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
          <Link to="/secciones-academicas" className="btn btn--secondary">
            Volver
          </Link>
        }
      />

      {/* 2/3: personal docente y materias · 1/3: cupo y alumnos inscritos (lista con scroll al alto de la izquierda). */}
      <div className="section-layout">
        <SectionTeachersCard key={teachersVersion} sectionId={id} onAssign={() => setAssigning(true)} />
        <div className="section-layout__side">
          <SectionRosterPanel
            section={section}
            roster={roster}
            loading={loadingRoster}
            error={withdrawError}
            onEnroll={() => setShowEnroll(true)}
            onWithdraw={handleWithdraw}
          />
        </div>
      </div>

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
    <Drawer title="Inscribir alumnos" onClose={onClose}>
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
    </Drawer>
  );
}

export default SectionDetailPage;
