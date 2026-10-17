import { useMemo, useState } from 'react';
import staffApi from '../../../api/endpoints/staff.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import { useExpandedSet } from '../../../hooks/useExpandedSet';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import DetailModal from '../../../components/ui/DetailModal';
import ImportButton from '../../../components/import/ImportButton';
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
import StaffAccessModal, { StaffAccessBadge } from '../components/StaffAccessModal';
import { CredentialsModal, formatDateTime } from '../../students/components/PortalAccessFields';

const VIEW_KEY = 'staff.view.v2';
const EXPAND_KEY = 'staff.expandedGroups';

const STAFF_TYPE_LABELS = {
  teaching: 'Docente',
  administrative: 'Administrativo',
  support: 'Obrero',
};
const STAFF_TYPE_ORDER = ['teaching', 'administrative', 'support'];

const STATUS_FILTERS = [
  ['', 'Todos'],
  ['active', 'Activos'],
  ['inactive', 'Inactivos'],
];

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const initialsOf = (r) => `${r.first_name?.[0] || ''}${r.last_name?.[0] || ''}`.toUpperCase();
const formatDate = (v) => (v ? new Date(v).toLocaleDateString('es', { timeZone: 'UTC' }) : null);
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = (r) => [fullName(r), r.national_id, r.email, r.phone, STAFF_TYPE_LABELS[r.staff_type], r.access_username].join(' ');

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'groups' ? 'groups' : 'list';
  } catch {
    return 'list';
  }
}

function StatusBadge({ status }) {
  return (
    <Badge variant={status === 'active' ? 'success' : 'neutral'}>
      {status === 'active' ? 'Activo' : 'Inactivo'}
    </Badge>
  );
}

function StatusFilter({ value, onChange, counts, total }) {
  return (
    <div className="level-filter" role="group" aria-label="Filtrar por estado">
      {STATUS_FILTERS.map(([code, label]) => (
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

/** Agrupa el personal por categoría (Docente / Administrativo / Obrero). */
function groupStaff(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const key = r.staff_type || 'other';
    if (!map.has(key)) map.set(key, { key, label: STAFF_TYPE_LABELS[key] ?? key, members: [] });
    map.get(key).members.push(r);
  });
  return [...map.values()].sort(
    (a, b) => (STAFF_TYPE_ORDER.indexOf(a.key) ?? 99) - (STAFF_TYPE_ORDER.indexOf(b.key) ?? 99)
  );
}

function StaffGroups({ rows, columns, searching, onView, onEdit, canEdit, canManageAccess, onManageAccess, collapseSignal }) {
  const groups = useMemo(() => groupStaff(rows), [rows]);
  const { isOpen, toggle, expandAll, collapseAll } = useExpandedSet(EXPAND_KEY);

  const [lastSignal, setLastSignal] = useState(collapseSignal);
  if (collapseSignal !== lastSignal) {
    setLastSignal(collapseSignal);
    if (collapseSignal?.action === 'collapse') collapseAll();
    else expandAll(groups.map((g) => g.key));
  }

  return (
    <div className="student-groups">
      {groups.map((g) => {
        const open = searching || isOpen(g.key);
        const bodyId = `staff-group-${g.key}`;
        const count = g.members.length;

        return (
          <div key={g.key}>
            <section className={`student-group ${open ? 'is-open' : ''}`}>
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
                  <span className="student-group__title">{g.label}</span>
                </button>
                <div className="student-group__side">
                  <span className="student-group__count">
                    {count} {count === 1 ? 'persona' : 'personas'}
                  </span>
                </div>
              </div>
              {open && (
                <div id={bodyId} className="student-group__body">
                  <DataTable
                    bare
                    columns={columns}
                    rows={g.members}
                    searchable={false}
                    paginated={false}
                    onView={onView}
                    onEdit={onEdit}
                    canEdit={canEdit}
                    rowActions={
                      canManageAccess
                        ? [{ key: 'access', icon: 'lock', label: 'Gestionar acceso al sistema', onClick: onManageAccess }]
                        : []
                    }
                    emptyMessage="Sin personal en esta categoría."
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

function StaffPage() {
  const { can } = useAuth();
  const { data: rows, loading, error, refetch } = useFetch(() => staffApi.list(), []);
  const [staffType, setStaffType] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [managingAccess, setManagingAccess] = useState(null);
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

  const canManageAccess = can('staff', 'update') && can('roles', 'update');
  const all = rows || [];

  // Filtros acumulativos: tipo + estado (+ búsqueda de texto).
  const matches = (r, skip) =>
    (skip === 'type' || !staffType || r.staff_type === staffType) &&
    (skip === 'status' || !status || r.status === status);

  const forStatus = all.filter((r) => matches(r, 'status'));
  const visible = all.filter((r) => matches(r));

  const statusCounts = {
    active: forStatus.filter((r) => r.status === 'active').length,
    inactive: forStatus.filter((r) => r.status === 'inactive').length,
  };

  const anyFilter = Boolean(staffType || status);
  const clearFilters = () => {
    setStaffType('');
    setStatus('');
  };

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? visible.filter((r) => normalize(searchText(r)).includes(q)) : visible;
  }, [visible, query]);

  // ── Columnas ──────────────────────────────────────────────────────────────
  const nameColumn = {
    key: 'name',
    header: 'Nombre',
    render: (r) => (
      <div className="cell-person">
        <span className="avatar avatar--sm">{initialsOf(r)}</span>
        <div>
          <div className="cell-person__name">{fullName(r)}</div>
        </div>
      </div>
    ),
    sortValue: (r) => `${r.last_name} ${r.first_name}`,
  };
  const documentColumn = {
    key: 'national_id',
    header: 'Cédula / documento',
    render: (r) => r.national_id || <span className="text-muted">—</span>,
    sortValue: (r) => r.national_id || '',
  };
  const categoryColumn = {
    key: 'staff_type',
    header: 'Categoría',
    render: (r) => <Badge variant="primary">{STAFF_TYPE_LABELS[r.staff_type] ?? r.staff_type}</Badge>,
    sortValue: (r) => STAFF_TYPE_ORDER.indexOf(r.staff_type),
  };
  const contactColumn = {
    key: 'contact',
    header: 'Contacto',
    render: (r) =>
      r.phone || r.email ? (
        <div className="contact-stack">
          {r.phone && (
            <span>
              <Icon name="user" size={13} /> {r.phone}
            </span>
          )}
          {r.email && (
            <span>
              <Icon name="inbox" size={13} /> {r.email}
            </span>
          )}
        </div>
      ) : (
        <span className="text-muted">Sin datos de contacto</span>
      ),
    sortValue: (r) => r.email || r.phone || null,
  };
  const statusColumn = {
    key: 'status',
    header: 'Estado',
    render: (r) => <StatusBadge status={r.status} />,
    sortValue: (r) => r.status,
  };
  const accessColumn = {
    key: 'access',
    header: 'Acceso',
    render: (r) => (
      <div title={r.access_username || 'Sin usuario de acceso'}>
        <StaffAccessBadge status={r.access_status} />
        {r.access_username && <div className="cell-person__sub portal-username">{r.access_username}</div>}
      </div>
    ),
    sortValue: (r) => ({ active: 0, inactive: 1 })[r.access_status] ?? 2,
  };

  const listColumns = [nameColumn, documentColumn, categoryColumn, contactColumn, statusColumn, accessColumn];
  const groupColumns = [nameColumn, documentColumn, contactColumn, statusColumn, accessColumn];

  const canCreate = can('staff', 'create');
  const importButton = canCreate && (
    <ImportButton type="staff" title="Importar personal desde Excel" onImported={refetch} />
  );

  const rowActions = canManageAccess
    ? [{ key: 'access', icon: 'lock', label: 'Gestionar acceso al sistema', onClick: setManagingAccess }]
    : [];

  // Categoría como selector junto al buscador.
  const categorySelect = (
    <div className="filter-bar__selects">
      <Select value={staffType} onChange={(e) => setStaffType(e.target.value)} aria-label="Filtrar por categoría">
        <option value="">Todas las categorías</option>
        {STAFF_TYPE_ORDER.map((key) => (
          <option key={key} value={key}>
            {STAFF_TYPE_LABELS[key]}
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

  // Pastillas de estado debajo.
  const filters = (
    <div className="filter-bar">
      <StatusFilter value={status} onChange={setStatus} counts={statusCounts} total={forStatus.length} />
    </div>
  );

  const viewToggle = (
    <div className="segmented" role="radiogroup" aria-label="Vista">
      {[
        ['list', 'Tabla', 'menu'],
        ['groups', 'Por categoría', 'layers'],
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
        title="Personal del colegio"
        subtitle="Administrativo, docente y obrero."
        actions={viewToggle}
      />

      {view === 'list' ? (
        <DataTable
          title="Listado de personal"
          columns={listColumns}
          rows={visible}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar por nombre, cédula, correo o categoría…"
          getSearchText={searchText}
          filters={filters}
          searchAddons={categorySelect}
          emptyMessage={anyFilter ? 'Ningún empleado con esos filtros.' : 'Aún no hay personal registrado.'}
          createLabel="Nuevo personal"
          onCreate={() => setEditing({})}
          canCreate={canCreate}
          headerActions={importButton}
          rowActions={rowActions}
          onView={setViewing}
          onEdit={setEditing}
          canEdit={can('staff', 'update')}
          onDelete={(r) => staffApi.remove(r.id)}
          canDelete={can('staff', 'delete')}
          deleteConfirm={(r) => ({
            title: `¿Eliminar a ${fullName(r)}?`,
            message: 'El registro del personal se eliminará del colegio. Esta acción no se puede deshacer.',
            successMessage: `${fullName(r)} fue eliminado`,
          })}
          onDeleted={refetch}
        />
      ) : (
        <>
          <div className="card data-table student-groups__toolbar">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  Personal por categoría
                  {!loading && rows && <span className="data-table__count">{filtered.length}</span>}
                </h3>
                <p className="card__subtitle">Docentes, personal administrativo y obrero del colegio.</p>
              </div>
              <div className="data-table__header-actions">
                {importButton}
                {canCreate && (
                  <Button icon="plus" onClick={() => setEditing({})}>
                    Nuevo personal
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
                    placeholder="Buscar por nombre, cédula, correo o categoría…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Buscar personal"
                  />
                  {query && (
                    <button type="button" className="data-table__clear" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </div>
                <div className="data-table__search-addons">{categorySelect}</div>
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
                {query || anyFilter ? 'Sin resultados' : 'Aún no hay personal registrado.'}
              </div>
              {query && <div className="text-sm">Ningún empleado coincide con "{query}".</div>}
            </div>
          ) : (
            <StaffGroups
              rows={filtered}
              columns={groupColumns}
              searching={Boolean(query)}
              onView={setViewing}
              onEdit={setEditing}
              canEdit={can('staff', 'update')}
              canManageAccess={canManageAccess}
              onManageAccess={setManagingAccess}
              collapseSignal={collapseSignal}
            />
          )}
        </>
      )}

      {viewing && (
        <DetailModal
          title={fullName(viewing)}
          subtitle={STAFF_TYPE_LABELS[viewing.staff_type]}
          badge={<StatusBadge status={viewing.status} />}
          fields={[
            { label: 'Cédula / documento', value: viewing.national_id },
            { label: 'Fecha de contratación', value: formatDate(viewing.hired_at) },
            { label: 'Teléfono', value: viewing.phone },
            { label: 'Correo', value: viewing.email },
          ]}
          onClose={() => setViewing(null)}
          onEdit={
            can('staff', 'update')
              ? () => {
                  setEditing(viewing);
                  setViewing(null);
                }
              : undefined
          }
        >
          <div className="detail-section">
            <h4 className="detail-section__title">
              <Icon name="lock" size={17} /> Acceso al sistema
              <StaffAccessBadge status={viewing.access_status} />
            </h4>
            <div className="portal-summary" style={{ margin: 0 }}>
              {viewing.access_username ? (
                <>
                  <span>
                    Usuario: <strong>{viewing.access_username}</strong>
                  </span>
                  <span className="text-muted">
                    {viewing.access_last_login_at
                      ? `Último ingreso: ${formatDateTime(viewing.access_last_login_at)}`
                      : 'Aún no ha ingresado'}
                  </span>
                </>
              ) : (
                <span className="text-muted">Todavía no tiene usuario para entrar al sistema.</span>
              )}
              {canManageAccess && (
                <Button
                  size="sm"
                  variant={viewing.access_username ? 'secondary' : 'primary'}
                  icon="lock"
                  onClick={() => {
                    setManagingAccess(viewing);
                    setViewing(null);
                  }}
                >
                  {viewing.access_username ? 'Gestionar credenciales' : 'Crear usuario de acceso'}
                </Button>
              )}
            </div>
          </div>
        </DetailModal>
      )}

      {editing !== null && (
        <StaffFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />
      )}

      {managingAccess && (
        <StaffAccessModal
          staff={managingAccess}
          onClose={() => setManagingAccess(null)}
          onSaved={({ access, temporaryPassword }) => {
            refetch();
            if (temporaryPassword) {
              setCredentials({ name: fullName(managingAccess), username: access.username, password: temporaryPassword });
            }
          }}
        />
      )}

      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </div>
  );
}

function StaffFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState({
    staffType: initial.staff_type || 'teaching',
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    nationalId: initial.national_id || '',
    phone: initial.phone || '',
    email: initial.email || '',
    hiredAt: initial.hired_at ? initial.hired_at.slice(0, 10) : '',
    status: initial.status || 'active',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => staffApi.update(initial.id, data) : staffApi.create
  );
  const toast = useToast();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run(form);
      toast.success(isEdit ? 'Cambios guardados' : 'Personal registrado', `${form.firstName} ${form.lastName}`);
      onSaved();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar personal' : 'Nuevo personal'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Nombres" error={fieldErrors.firstName} required>
            <Input name="firstName" value={form.firstName} onChange={handleChange} required />
          </Field>
          <Field label="Apellidos" error={fieldErrors.lastName} required>
            <Input name="lastName" value={form.lastName} onChange={handleChange} required />
          </Field>
          <Field label="Tipo de personal" error={fieldErrors.staffType}>
            <Select name="staffType" value={form.staffType} onChange={handleChange}>
              <option value="teaching">Docente</option>
              <option value="administrative">Administrativo</option>
              <option value="support">Obrero</option>
            </Select>
          </Field>
          <Field label="Cédula / documento" error={fieldErrors.nationalId}>
            <Input name="nationalId" value={form.nationalId} onChange={handleChange} />
          </Field>
          <Field label="Teléfono" error={fieldErrors.phone}>
            <Input name="phone" value={form.phone} onChange={handleChange} />
          </Field>
          <Field label="Correo" error={fieldErrors.email}>
            <Input type="email" name="email" value={form.email} onChange={handleChange} />
          </Field>
          <Field label="Fecha de contratación" error={fieldErrors.hiredAt}>
            <Input type="date" name="hiredAt" value={form.hiredAt} onChange={handleChange} />
          </Field>
          {isEdit && (
            <Field label="Estado">
              <Select name="status" value={form.status} onChange={handleChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </Select>
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default StaffPage;
