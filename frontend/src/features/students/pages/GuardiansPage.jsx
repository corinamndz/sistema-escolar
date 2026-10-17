import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { useExpandedSet } from '../../../hooks/useExpandedSet';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Table from '../../../components/ui/Table';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { LEVELS, LevelBadge, LevelFilter } from '../../academics/levels';
import { sectionLabel } from '../components/StudentGroups';
import {
  PortalAccessFields,
  PortalStatusBadge,
  CredentialsModal,
  initialPortalState,
  validatePortal,
  buildPortalPayload,
  portalOf,
  formatDateTime,
} from '../components/PortalAccessFields';

const VIEW_KEY = 'guardians.view.v2';
const EXPAND_KEY = 'guardians.expandedGroups';
const NO_SECTION = 'none';

const PORTAL_FILTERS = [
  ['', 'Todos'],
  ['active', 'Con portal'],
  ['no-portal', 'Sin portal'],
];

const STUDENT_STATUS = {
  active: ['Activo', 'success'],
  inactive: ['Inactivo', 'neutral'],
  graduated: ['Egresado', 'primary'],
  withdrawn: ['Retirado', 'danger'],
};

const fullName = (p) => `${p.first_name} ${p.last_name}`;
const initialsOf = (p) => `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase();
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = (g) => [fullName(g), g.national_id, g.email, g.phone, g.portal_username, ...(g.student_names || [])].join(' ');
const byText = (a, b) => (a || '').localeCompare(b || '', 'es', { numeric: true });
const portalKey = (g) => (g.portal_status === 'active' ? 'active' : !g.portal_username ? 'no-portal' : null);

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'groups' ? 'groups' : 'list';
  } catch {
    return 'list';
  }
}

function PortalFilter({ value, onChange, counts, total }) {
  return (
    <div className="level-filter" role="group" aria-label="Filtrar por acceso al portal">
      {PORTAL_FILTERS.map(([code, label]) => (
        <button
          key={code || 'all'}
          type="button"
          className={`level-filter__item ${value === code ? 'level-filter__item--active' : ''}`}
          onClick={() => onChange(code)}
          aria-pressed={value === code}
        >
          {label}
          <span className="level-filter__count">{code ? counts[code] || 0 : total}</span>
        </button>
      ))}
    </div>
  );
}

/** Agrupa representantes por la sección de sus alumnos. Un representante con
 *  alumnos en varias secciones aparece en cada grupo correspondiente. */
function groupGuardians(rows, gradeIdFilter, sectionFilter) {
  const map = new Map();
  rows.forEach((g) => {
    let enrolled = (g.students_detail || []).filter((s) => s.section_id);
    if (gradeIdFilter) enrolled = enrolled.filter((s) => s.grade_id === gradeIdFilter);
    if (sectionFilter) enrolled = enrolled.filter((s) => s.section_name === sectionFilter);

    if (!enrolled.length) {
      if (!map.has(NO_SECTION)) {
        map.set(NO_SECTION, { key: NO_SECTION, sectionId: null, sectionName: null, gradeName: null, levelCode: null, levelSort: 99, gradeSort: 0, periodName: null, guardians: [] });
      }
      const group = map.get(NO_SECTION);
      if (!group.guardians.find((x) => x.id === g.id)) group.guardians.push(g);
    } else {
      const seen = new Set();
      enrolled.forEach((s) => {
        if (seen.has(s.section_id)) return;
        seen.add(s.section_id);
        if (!map.has(s.section_id)) {
          map.set(s.section_id, {
            key: s.section_id,
            sectionId: s.section_id,
            sectionName: s.section_name,
            gradeName: s.grade_name,
            levelCode: s.level_code,
            levelSort: s.level_sort ?? 99,
            gradeSort: s.grade_sort ?? 0,
            periodName: s.school_period_name,
            guardians: [],
          });
        }
        map.get(s.section_id).guardians.push(g);
      });
    }
  });
  return [...map.values()].sort(
    (a, b) =>
      (a.key === NO_SECTION) - (b.key === NO_SECTION) ||
      a.levelSort - b.levelSort ||
      a.gradeSort - b.gradeSort ||
      byText(a.gradeName, b.gradeName) ||
      byText(a.sectionName, b.sectionName)
  );
}

function GuardianGroups({ rows, columns, searching, gradeId, section, onView, onEdit, canEdit, collapseSignal }) {
  const groups = useMemo(() => groupGuardians(rows, gradeId, section), [rows, gradeId, section]);
  const { isOpen, toggle, expandAll, collapseAll } = useExpandedSet(EXPAND_KEY);

  const [lastSignal, setLastSignal] = useState(collapseSignal);
  if (collapseSignal !== lastSignal) {
    setLastSignal(collapseSignal);
    if (collapseSignal?.action === 'collapse') collapseAll();
    else expandAll(groups.map((g) => g.key));
  }

  let currentLevel = null;
  return (
    <div className="student-groups">
      {groups.map((g) => {
        const open = searching || isOpen(g.key);
        const bodyId = `guardian-group-${g.key}`;
        const count = g.guardians.length;
        const isNone = g.key === NO_SECTION;
        const levelKey = isNone ? NO_SECTION : g.levelCode;
        const heading = levelKey !== currentLevel ? (isNone ? 'Sin inscripción vigente' : LEVELS[g.levelCode]?.name) : null;
        currentLevel = levelKey;

        return (
          <div key={g.key}>
            {heading && <h3 className="student-groups__level">{heading}</h3>}
            <section className={`student-group ${open ? 'is-open' : ''} ${isNone ? 'student-group--none' : ''}`}>
              <div className="student-group__header">
                <button
                  type="button"
                  className="student-group__toggle"
                  onClick={() => toggle(g.key)}
                  aria-expanded={open}
                  aria-controls={bodyId}
                  disabled={searching}
                >
                  <Icon name="chevronDown" size={16} className="student-group__chevron" />
                  <span className="student-group__title">
                    {isNone ? (
                      'Sin sección asignada'
                    ) : (
                      <>
                        {g.gradeName} <span className="student-group__sep">·</span> {sectionLabel(g.sectionName)}
                      </>
                    )}
                  </span>
                  {!isNone && <LevelBadge code={g.levelCode} />}
                  <span className="student-group__meta">
                    {isNone ? 'Sus alumnos no tienen inscripción activa' : `Año escolar ${g.periodName}`}
                  </span>
                </button>
                <div className="student-group__side">
                  <span className="student-group__count">
                    {count} {count === 1 ? 'representante' : 'representantes'}
                  </span>
                </div>
              </div>
              {open && (
                <div id={bodyId} className="student-group__body">
                  <DataTable
                    bare
                    columns={columns}
                    rows={g.guardians}
                    searchable={false}
                    paginated={false}
                    onView={onView}
                    onEdit={onEdit}
                    canEdit={canEdit}
                    emptyMessage="Sin representantes."
                  />
                </div>
              )}
            </section>
          </div>
        );
      })}
    </div>
  );
}

function GuardiansPage() {
  const { can } = useAuth();
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.listGuardians(), []);
  const [portalStatus, setPortalStatus] = useState('');
  const [level, setLevel] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [section, setSection] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [view, setView] = useState(readView);
  const [query, setQuery] = useState('');
  const [collapseSignal, setCollapseSignal] = useState(null);

  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // preferencia no persistente
    }
  };

  const all = rows || [];

  // Filtros acumulativos: portal + nivel + grado + sección (+ búsqueda de texto).
  const matches = (g, skip) =>
    (skip === 'portal' || !portalStatus || portalKey(g) === portalStatus) &&
    (skip === 'level' || !level || (g.students_detail || []).some((s) => s.level_code === level)) &&
    (skip === 'grade' || !gradeId || (g.students_detail || []).some((s) => s.grade_id === gradeId)) &&
    (skip === 'section' || !section || (g.students_detail || []).some((s) => s.section_name === section));

  const forPortal = all.filter((g) => matches(g, 'portal'));
  const forLevel = all.filter((g) => matches(g, 'level'));
  const visible = all.filter((g) => matches(g));

  const portalCounts = {
    active: forPortal.filter((g) => g.portal_status === 'active').length,
    'no-portal': forPortal.filter((g) => !g.portal_username).length,
  };
  const levelCounts = {};
  forLevel.forEach((g) => {
    new Set((g.students_detail || []).map((s) => s.level_code).filter(Boolean)).forEach((lc) => {
      levelCounts[lc] = (levelCounts[lc] || 0) + 1;
    });
  });

  const gradeOptions = useMemo(() => {
    const map = new Map();
    all.forEach((g) => {
      (g.students_detail || [])
        .filter((s) => s.grade_id && (!level || s.level_code === level))
        .forEach((s) => {
          if (!map.has(s.grade_id))
            map.set(s.grade_id, {
              id: s.grade_id,
              name: s.grade_name,
              order: `${s.level_sort ?? 99}-${String(s.grade_sort ?? 0).padStart(3, '0')}-${s.grade_name}`,
            });
        });
    });
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order, 'es', { numeric: true }));
  }, [all, level]);

  const validGradeId = gradeOptions.some((g) => g.id === gradeId) ? gradeId : '';

  const sectionOptions = useMemo(
    () =>
      [
        ...new Set(
          all
            .flatMap((g) => g.students_detail || [])
            .filter((s) => s.section_name && (!level || s.level_code === level) && (!validGradeId || s.grade_id === validGradeId))
            .map((s) => s.section_name)
        ),
      ].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
    [all, level, validGradeId]
  );

  useEffect(() => {
    if (gradeId && !gradeOptions.some((g) => g.id === gradeId)) setGradeId('');
  }, [gradeId, gradeOptions]);
  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [section, sectionOptions]);

  const anyFilter = Boolean(portalStatus || level || gradeId || section);
  const clearFilters = () => {
    setPortalStatus('');
    setLevel('');
    setGradeId('');
    setSection('');
  };

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? visible.filter((g) => normalize(searchText(g)).includes(q)) : visible;
  }, [visible, query]);

  // ── Columnas ──────────────────────────────────────────────────────────────
  const nameColumn = {
    key: 'name',
    header: 'Representante',
    render: (g) => (
      <div className="cell-person">
        <span className="avatar avatar--sm">{initialsOf(g)}</span>
        <div>
          <div className="cell-person__name">{fullName(g)}</div>
        </div>
      </div>
    ),
    sortValue: (g) => `${g.last_name} ${g.first_name}`,
  };
  const documentColumn = {
    key: 'national_id',
    header: 'Cédula / documento',
    render: (g) => g.national_id || <span className="text-muted">—</span>,
    sortValue: (g) => g.national_id || '',
  };
  const studentsColumn = {
    key: 'students',
    header: 'Alumnos a cargo',
    render: (g) =>
      g.student_count === 0 ? (
        <span className="teacher-stack__missing">Sin alumnos</span>
      ) : (
        <div className="chip-list">
          {(g.student_names || []).slice(0, 2).map((name) => (
            <span key={name} className="chip">
              {name}
            </span>
          ))}
          {g.student_count > 2 && <span className="chip">+{g.student_count - 2}</span>}
        </div>
      ),
    sortValue: (g) => g.student_count,
  };
  const contactColumn = {
    key: 'contact',
    header: 'Contacto',
    render: (g) =>
      g.phone || g.email ? (
        <div className="contact-stack">
          {g.phone && (
            <span>
              <Icon name="user" size={13} /> {g.phone}
            </span>
          )}
          {g.email && (
            <span>
              <Icon name="inbox" size={13} /> {g.email}
            </span>
          )}
        </div>
      ) : (
        <span className="text-muted">Sin datos de contacto</span>
      ),
    sortValue: (g) => g.email || g.phone || null,
  };
  const portalColumn = {
    key: 'portal',
    header: 'Portal',
    render: (g) => (
      <div title={g.portal_username || undefined}>
        <PortalStatusBadge portal={portalOf(g)} />
        {g.portal_username && <div className="cell-person__sub portal-username">{g.portal_username}</div>}
      </div>
    ),
    sortValue: (g) => ({ active: 0, inactive: 1 })[g.portal_status] ?? 2,
  };

  const listColumns = [nameColumn, documentColumn, studentsColumn, contactColumn, portalColumn];
  const groupColumns = [nameColumn, documentColumn, contactColumn, portalColumn];

  const canCreate = can('guardians', 'create');
  const canEdit = can('guardians', 'update');

  // Fila de arriba: grado y sección junto al buscador.
  const gradeSectionFilters = (
    <div className="filter-bar__selects">
      <Select value={gradeId} onChange={(e) => setGradeId(e.target.value)} aria-label="Filtrar por grado" disabled={!gradeOptions.length}>
        <option value="">Todos los grados</option>
        {gradeOptions.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filtrar por sección" disabled={!sectionOptions.length}>
        <option value="">Todas las secciones</option>
        {sectionOptions.map((name) => (
          <option key={name} value={name}>
            {sectionLabel(name)}
          </option>
        ))}
      </Select>
      {anyFilter && (
        <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );

  // Fila de abajo: pastillas de portal y nivel.
  const filters = (
    <div className="filter-bar">
      <PortalFilter value={portalStatus} onChange={setPortalStatus} counts={portalCounts} total={forPortal.length} />
      <LevelFilter value={level} onChange={setLevel} counts={levelCounts} total={forLevel.length} />
    </div>
  );

  const viewToggle = (
    <div className="segmented" role="radiogroup" aria-label="Vista">
      {[
        ['list', 'Tabla', 'menu'],
        ['groups', 'Por sección', 'layers'],
      ].map(([key, label, icon]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={view === key}
          className={`segmented__item ${view === key ? 'segmented__item--active' : ''}`}
          onClick={() => changeView(key)}
        >
          <Icon name={icon} size={15} /> {label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Representantes"
        subtitle="Padres, madres y representantes legales de los alumnos."
        actions={viewToggle}
      />

      {view === 'list' ? (
        <DataTable
          title="Listado de representantes"
          columns={listColumns}
          rows={visible}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar por nombre, cédula, correo o alumno…"
          getSearchText={searchText}
          filters={filters}
          searchAddons={gradeSectionFilters}
          emptyMessage={anyFilter ? 'Ningún representante con esos filtros.' : 'Aún no hay representantes registrados.'}
          createLabel="Nuevo representante"
          onCreate={() => setEditing({})}
          canCreate={canCreate}
          onView={(g) => setViewingId(g.id)}
          onEdit={setEditing}
          canEdit={canEdit}
          onDelete={(g) => studentsApi.deleteGuardian(g.id)}
          canDelete={can('guardians', 'delete')}
          deleteConfirm={(g) => ({
            title: `¿Eliminar a ${fullName(g)}?`,
            message:
              (g.student_count > 0
                ? `Se quitará su vínculo con ${g.student_count} alumno(s) (los alumnos no se eliminan). `
                : '') +
              (g.portal_status === 'active' ? 'Su usuario del portal quedará inactivo. ' : '') +
              'Si tiene pagos registrados no se podrá eliminar. Esta acción no se puede deshacer.',
            successMessage: `${fullName(g)} fue eliminado`,
          })}
          onDeleted={refetch}
        />
      ) : (
        <>
          <div className="card data-table student-groups__toolbar">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  Representantes por grado y sección
                  {!loading && rows && <span className="data-table__count">{filtered.length}</span>}
                </h3>
                <p className="card__subtitle">Cada grupo lista los representantes con alumnos inscritos en esa sección.</p>
              </div>
              <div className="data-table__header-actions">
                {canCreate && (
                  <Button icon="plus" onClick={() => setEditing({})}>
                    Nuevo representante
                  </Button>
                )}
              </div>
            </div>
            <div className="data-table__toolbar data-table__toolbar--stacked">
              <div className="data-table__search-row">
                <div className="input-group data-table__search">
                  <Icon name="search" size={17} className="input-group__icon" />
                  <input
                    type="search"
                    className="input"
                    placeholder="Buscar por nombre, cédula, correo o alumno…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar representantes"
                  />
                  {query && (
                    <button type="button" className="data-table__clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </div>
                <div className="data-table__search-addons">{gradeSectionFilters}</div>
              </div>
              <div className="data-table__filters">
                {filters}
                <Button
                  variant="ghost"
                  size="sm"
                  icon="chevronDown"
                  onClick={() => setCollapseSignal({ action: 'expand', at: Date.now() })}
                  disabled={Boolean(query)}
                >
                  Expandir todo
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="chevronRight"
                  onClick={() => setCollapseSignal({ action: 'collapse', at: Date.now() })}
                  disabled={Boolean(query)}
                >
                  Contraer todo
                </Button>
              </div>
            </div>
            <Alert>{error}</Alert>
          </div>

          {loading ? (
            <Spinner />
          ) : filtered.length === 0 ? (
            <div className="card empty-state">
              <div className="empty-state__icon">
                <Icon name={query ? 'search' : 'users'} size={24} />
              </div>
              <div className="empty-state__title">
                {query || anyFilter ? 'Sin resultados' : 'Aún no hay representantes registrados.'}
              </div>
              {query && <div className="text-sm">Ningún representante coincide con "{query}".</div>}
            </div>
          ) : (
            <GuardianGroups
              rows={filtered}
              columns={groupColumns}
              searching={Boolean(query)}
              gradeId={validGradeId}
              section={section}
              onView={(g) => setViewingId(g.id)}
              onEdit={setEditing}
              canEdit={canEdit}
              collapseSignal={collapseSignal}
            />
          )}
        </>
      )}

      {viewingId && (
        <GuardianDetailModal
          guardianId={viewingId}
          onClose={() => setViewingId(null)}
          onEdit={
            canEdit
              ? (g) => {
                  setViewingId(null);
                  setEditing(g);
                }
              : undefined
          }
        />
      )}

      {editing !== null && (
        <GuardianFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            refetch();
            if (saved.temporaryPassword) {
              setCredentials({ name: fullName(saved), username: saved.portal.username, password: saved.temporaryPassword });
            }
          }}
        />
      )}

      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

/** Detalle del representante con la tabla de sus alumnos (grado y sección actual). */
function GuardianDetailModal({ guardianId, onClose, onEdit }) {
  const { data: guardian, loading, error } = useFetch(() => studentsApi.getGuardian(guardianId), [guardianId]);

  const studentColumns = [
    {
      key: 'name',
      header: 'Alumno',
      render: (s) => (
        <div>
          <div className="assign-table__subject">
            <Link to={`/students/${s.id}`} onClick={onClose}>
              {fullName(s)}
            </Link>
            {s.is_primary && <span className="chip chip--primary-guardian">Principal</span>}
          </div>
          <div className="cell-person__sub">
            {[s.relationship, s.national_id].filter(Boolean).join(' · ') || 'Sin documento'}
          </div>
        </div>
      ),
      sortValue: (s) => `${s.last_name} ${s.first_name}`,
    },
    {
      key: 'section',
      header: 'Grado y sección',
      render: (s) =>
        s.section_id ? (
          <div>
            <Link to={`/academics/sections/${s.section_id}`} onClick={onClose} className="cell-person__name">
              {s.grade_name} · Sección {s.section_name}
            </Link>
            <div className="student-level">
              <LevelBadge code={s.level_code} />
              <span className="cell-person__sub">{s.school_period_name}</span>
            </div>
          </div>
        ) : (
          <span className="teacher-stack__missing">Sin inscripción activa</span>
        ),
      sortValue: (s) => (s.section_id ? `${s.grade_name} ${s.section_name}` : null),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (s) => {
        const [label, variant] = STUDENT_STATUS[s.status] || ['—', 'neutral'];
        return <Badge variant={variant}>{label}</Badge>;
      },
    },
  ];

  return (
    <Modal title={guardian ? fullName(guardian) : 'Representante'} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      {loading || !guardian ? (
        <Spinner />
      ) : (
        <>
          <div className="guardian-hero">
            <span className="avatar">{initialsOf(guardian)}</span>
            <div>
              <div className="cell-person__name">{fullName(guardian)}</div>
              <div className="cell-person__sub">Representante</div>
            </div>
            <PortalStatusBadge portal={guardian.portal} />
          </div>

          {guardian.portal && (
            <div className="portal-summary">
              <Icon name="lock" size={16} />
              <span>
                Usuario del portal: <strong>{guardian.portal.username}</strong>
              </span>
              <span className="text-muted">
                {guardian.portal.last_login_at
                  ? `Último ingreso: ${formatDateTime(guardian.portal.last_login_at)}`
                  : 'Aún no ha ingresado'}
              </span>
            </div>
          )}

          <dl className="detail-list">
            {[
              ['Cédula / documento', guardian.national_id],
              ['Teléfono', guardian.phone],
              ['Correo', guardian.email, 'Se usa para enviar los comprobantes de pago.'],
              ['Alumnos a cargo', String(guardian.students.length)],
            ].map(([label, value, hint]) => (
              <div key={label} className="detail-list__item">
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
                {hint && value && <div className="cell-person__sub">{hint}</div>}
              </div>
            ))}
          </dl>

          <div className="detail-section">
            <h4 className="detail-section__title">
              <Icon name="graduation" size={17} />
              Alumnos asociados
              <span className="data-table__count">{guardian.students.length}</span>
            </h4>
            <Table
              columns={studentColumns}
              rows={guardian.students}
              emptyMessage="Este representante no tiene alumnos asociados. Se vinculan desde la ficha de cada alumno."
            />
          </div>

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
            {onEdit && (
              <Button type="button" icon="pencil" onClick={() => onEdit(guardian)}>
                Editar
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function GuardianFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    nationalId: initial.national_id || '',
    phone: initial.phone || '',
    email: initial.email || '',
  });
  const [portal, setPortal] = useState(() => initialPortalState(initial));
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => studentsApi.updateGuardian(initial.id, data) : studentsApi.createGuardian
  );
  const toast = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (name === 'email') setPortal((p) => (p.emailTouched ? p : { ...p, email: value }));
  };

  const portalErrors = validatePortal(portal);
  const portalInvalid = Object.keys(portalErrors).length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (portalInvalid) return;
    try {
      const saved = await run({ ...form, portal: buildPortalPayload(portal) });
      const portalMsg = saved.temporaryPassword
        ? ' · usuario del portal listo'
        : saved.portal && !portal.existing
          ? ' · usuario del portal creado'
          : '';
      toast.success(isEdit ? 'Cambios guardados' : 'Representante registrado', `${form.firstName} ${form.lastName}${portalMsg}`);
      onClose();
      onSaved(saved);
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? `Editar a ${initial.first_name} ${initial.last_name}` : 'Nuevo representante'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName} required>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName} required>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} maxLength={30} />
          </Field>
          <Field label="Teléfono" error={fieldErrors.phone}>
            <Input name="phone" value={form.phone} onChange={handleChange} maxLength={30} />
          </Field>
          <Field label="Correo" error={fieldErrors.email} hint="Se usa para enviar los comprobantes de pago." full>
            <Input icon="inbox" type="email" name="email" value={form.email} onChange={handleChange} placeholder="representante@correo.com" />
          </Field>
        </div>
        <PortalAccessFields state={portal} setState={setPortal} fieldErrors={fieldErrors} />

        {isEdit && (
          <p className="text-sm" style={{ marginTop: 14 }}>
            Para vincular o desvincular alumnos, hazlo desde la ficha de cada alumno.
          </p>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={portalInvalid}>
            {isEdit ? 'Guardar cambios' : 'Crear representante'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default GuardiansPage;
