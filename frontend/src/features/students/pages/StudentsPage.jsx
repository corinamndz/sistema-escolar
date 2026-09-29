import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import ImportButton from '../../../components/import/ImportButton';
import StudentGroups, { sectionLabel } from '../components/StudentGroups';

const STATUS_LABELS = { active: ['Activo', 'success'], inactive: ['Inactivo', 'neutral'], graduated: ['Egresado', 'primary'], withdrawn: ['Retirado', 'danger'] };
const VIEW_KEY = 'students.view';

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('es', { timeZone: 'UTC' }) : null);
/** Mismo criterio que la búsqueda de DataTable: sin acentos ni mayúsculas. */
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = (r) => [fullName(r), r.national_id, r.grade_name, r.section_name && sectionLabel(r.section_name)].join(' ');

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'groups';
  } catch {
    return 'groups';
  }
}

function StudentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.list(status ? { status } : undefined), [status]);
  const [editing, setEditing] = useState(null); // null = cerrado, {} = crear, {...} = editar
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

  const nameColumn = {
    key: 'name',
    header: 'Alumno',
    render: (r) => (
      <Link to={`/students/${r.id}`} className="cell-person__name">
        {fullName(r)}
      </Link>
    ),
    sortValue: (r) => `${r.last_name} ${r.first_name}`,
  };
  const baseColumns = [
    { key: 'national_id', header: 'Documento', render: (r) => r.national_id || '—' },
    { key: 'birth_date', header: 'Nacimiento', render: (r) => formatDate(r.birth_date) || '—', sortValue: (r) => r.birth_date },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => {
        const [label, variant] = STATUS_LABELS[r.status] || ['—', 'neutral'];
        return <Badge variant={variant}>{label}</Badge>;
      },
      sortValue: (r) => r.status,
    },
  ];
  // En la lista plana se agrega la columna de grado y sección (en la vista agrupada ya está en la cabecera).
  const listColumns = [
    nameColumn,
    {
      key: 'section',
      header: 'Grado y sección',
      render: (r) => (r.section_id ? `${r.grade_name} · ${sectionLabel(r.section_name)}` : <span className="text-muted">Sin inscripción</span>),
      sortValue: (r) => (r.section_id ? `${r.level_sort}-${String(r.grade_sort).padStart(3, '0')}-${r.grade_name}-${r.section_name}` : '~'),
    },
    ...baseColumns,
  ];

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? (rows || []).filter((r) => normalize(searchText(r)).includes(q)) : rows || [];
  }, [rows, query]);

  const canCreate = can('students', 'create');
  const importButton = canCreate && (
    <ImportButton
      type="students"
      title="Importar alumnos desde Excel"
      description="Incluye grado y sección para inscribirlos en el año activo, y la cédula de un representante ya registrado para vincularlo."
      onImported={refetch}
    />
  );
  const statusFilter = (
    <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado">
      <option value="">Todos los estados</option>
      {Object.entries(STATUS_LABELS).map(([value, [label]]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </Select>
  );

  const viewToggle = (
    <div className="segmented" role="radiogroup" aria-label="Vista">
      {[
        ['groups', 'Por sección', 'layers'],
        ['list', 'Lista', 'menu'],
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
      <PageHeader title="Alumnos" subtitle="Matrícula del colegio" actions={viewToggle} />

      {view === 'list' ? (
        <DataTable
          title="Listado de alumnos"
          columns={listColumns}
          rows={rows}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar por nombre, documento, grado o sección…"
          getSearchText={searchText}
          filters={statusFilter}
          emptyMessage="Aún no hay alumnos registrados."
          createLabel="Nuevo alumno"
          onCreate={() => setEditing({})}
          canCreate={canCreate}
          headerActions={importButton}
          // "Ver" abre la ficha completa (representantes, sección actual), que ya es una página propia.
          onView={(r) => navigate(`/students/${r.id}`)}
          onEdit={setEditing}
          canEdit={can('students', 'update')}
          // Sin onDelete: el backend no expone DELETE /students/:id. Para dar de baja se cambia el estado.
        />
      ) : (
        <>
          <div className="card data-table student-groups__toolbar">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  Matrícula por grado y sección
                  {!loading && rows && <span className="data-table__count">{rows.length}</span>}
                </h3>
                <p className="card__subtitle">Cada grupo muestra los alumnos inscritos en esa sección del año escolar vigente.</p>
              </div>
              <div className="data-table__header-actions">
                {importButton}
                {canCreate && (
                  <Button icon="plus" onClick={() => setEditing({})}>
                    Nuevo alumno
                  </Button>
                )}
              </div>
            </div>
            <div className="data-table__toolbar">
              <div className="input-group data-table__search">
                <Icon name="search" size={17} className="input-group__icon" />
                <input
                  type="search"
                  className="input"
                  placeholder="Buscar por nombre, documento, grado o sección…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Buscar alumnos"
                />
                {query && (
                  <button type="button" className="data-table__clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                    <Icon name="x" size={15} />
                  </button>
                )}
              </div>
              <div className="data-table__filters">
                {statusFilter}
                <Button variant="ghost" size="sm" icon="chevronDown" onClick={() => setCollapseSignal({ action: 'expand', at: Date.now() })} disabled={Boolean(query)}>
                  Expandir todo
                </Button>
                <Button variant="ghost" size="sm" icon="chevronRight" onClick={() => setCollapseSignal({ action: 'collapse', at: Date.now() })} disabled={Boolean(query)}>
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
              <div className="empty-state__title">{query ? 'Sin resultados' : 'Aún no hay alumnos registrados.'}</div>
              {query && <div className="text-sm">Ningún alumno coincide con “{query}”.</div>}
            </div>
          ) : (
            <StudentGroups
              rows={filtered}
              columns={[nameColumn, ...baseColumns]}
              searching={Boolean(query)}
              // Cupos solo tienen sentido sin filtro de estado (con filtro, el conteo no es la matrícula de la sección).
              showCapacity={!status && !query}
              collapseSignal={collapseSignal}
              onView={(r) => navigate(`/students/${r.id}`)}
              onEdit={setEditing}
              canEdit={can('students', 'update')}
            />
          )}
        </>
      )}

      {editing !== null && <StudentFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
    </div>
  );
}

function StudentFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    birthDate: initial.birth_date ? initial.birth_date.slice(0, 10) : '',
    nationalId: initial.national_id || '',
    status: initial.status || 'active',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => studentsApi.update(initial.id, data) : studentsApi.create
  );
  const toast = useToast();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Campos opcionales vacíos no se envían (una fecha "" no es válida para la BD).
    const data = {
      firstName: form.firstName,
      lastName: form.lastName,
      birthDate: form.birthDate || undefined,
      nationalId: form.nationalId || undefined,
      ...(isEdit ? { status: form.status } : {}),
    };
    try {
      await run(data);
      toast.success(isEdit ? 'Cambios guardados' : 'Alumno registrado', `${form.firstName} ${form.lastName}`);
      onSaved();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar alumno' : 'Nuevo alumno'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName} required>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName} required>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Fecha de nacimiento" error={fieldErrors.birthDate}>
            <Input type="date" name="birthDate" value={form.birthDate} onChange={handleChange} />
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} />
          </Field>
          {isEdit && (
            <Field label="Estado" error={fieldErrors.status} hint="Para dar de baja a un alumno, márcalo como Retirado.">
              <Select name="status" value={form.status} onChange={handleChange}>
                {Object.entries(STATUS_LABELS).map(([value, [label]]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Guardar cambios' : 'Crear alumno'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default StudentsPage;
