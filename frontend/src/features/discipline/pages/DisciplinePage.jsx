import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import disciplineApi from '../../../api/endpoints/discipline.api';
import studentsApi from '../../../api/endpoints/students.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Modal from '../../../components/ui/Modal';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import ExportButton from '../../../components/ui/ExportButton';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { termLabel } from '../../evaluation-plans/terms';
import { SanctionCard, SanctionFormModal, SeverityBadge, SeverityTotals, SEVERITIES, SEVERITY_KEYS } from '../components/SanctionParts';

const SUBTITLE = 'Registro de sanciones disciplinarias de los alumnos. Las familias las ven en el portal; cada docente, en la ficha de sus alumnos.';

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const gradeSection = (r) => (r.grade_name ? `${r.grade_name} · Sección ${r.section_name}` : null);
const sortEs = (a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/**
 * Convivencia. Administración: tabla general (búsqueda, filtros por gravedad,
 * grado, sección y tipo de falta) para manejar volumen. Docente con carga
 * restringida: tarjetas con las sanciones de sus alumnos.
 */
function DisciplinePage() {
  const { user } = useAuth();
  return user?.isRestrictedTeacher ? <TeacherDisciplineView /> : <SchoolDisciplineView />;
}

/** Formulario de registro/edición compartido por ambas vistas (los alumnos solo se cargan si puede registrar). */
function useSanctionForm(onSaved) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const canCreate = can('discipline', 'create');
  const { data: students } = useFetch(() => (canCreate ? studentsApi.list({ status: 'active' }) : Promise.resolve([])), [canCreate]);

  const modal = editing && (
    <SanctionFormModal
      initial={editing.id ? editing : null}
      students={students || []}
      onClose={() => setEditing(null)}
      onSaved={() => {
        toast.success(editing.id ? 'Sanción actualizada' : 'Sanción registrada');
        onSaved();
      }}
    />
  );
  return { canCreate, setEditing, modal };
}

// ---------------------------------------------------------------------------
// Administración: tabla general
// ---------------------------------------------------------------------------

function SchoolDisciplineView() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useFetch(() => disciplineApi.list(), []);
  const { canCreate, setEditing, modal } = useSanctionForm(refetch);
  const [severity, setSeverity] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [fault, setFault] = useState('');
  const [viewing, setViewing] = useState(null);

  const all = useMemo(() => data?.items || [], [data]);
  const matches = (r, skip) =>
    (skip === 'severity' || !severity || r.severity === severity) &&
    (skip === 'grade' || !grade || r.grade_name === grade) &&
    (skip === 'section' || !section || r.section_name === section) &&
    (skip === 'fault' || !fault || r.fault_type === fault);
  const visible = all.filter((r) => matches(r));
  const forSeverity = all.filter((r) => matches(r, 'severity'));
  const severityCounts = SEVERITY_KEYS.reduce((acc, k) => ({ ...acc, [k]: forSeverity.filter((r) => r.severity === k).length }), {});

  // Opciones en cascada: cada selector ofrece lo que dejan los filtros anteriores.
  const gradeOptions = useMemo(() => [...new Set(all.map((r) => r.grade_name).filter(Boolean))].sort(sortEs), [all]);
  const sectionOptions = useMemo(
    () => [...new Set(all.filter((r) => !grade || r.grade_name === grade).map((r) => r.section_name).filter(Boolean))].sort(sortEs),
    [all, grade]
  );
  const faultOptions = useMemo(() => [...new Set(all.map((r) => r.fault_type).filter(Boolean))].sort(sortEs), [all]);
  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [section, sectionOptions]);

  const anyFilter = Boolean(severity || grade || section || fault);
  const clearFilters = () => {
    setSeverity('');
    setGrade('');
    setSection('');
    setFault('');
  };

  const columns = [
    {
      key: 'student',
      header: 'Alumno',
      render: (r) => (
        <div>
          <Link to={`/students/${r.student_id}`} className="cell-person__name">
            {fullName(r)}
          </Link>
          {r.registered_by_name && <div className="cell-person__sub">Registró: {r.registered_by_name}</div>}
        </div>
      ),
      sortValue: (r) => `${r.last_name} ${r.first_name}`,
    },
    { key: 'national_id', header: 'Cédula / documento', render: (r) => r.national_id || <span className="text-muted">—</span>, sortValue: (r) => r.national_id || '' },
    {
      key: 'section',
      header: 'Grado y sección',
      render: (r) => gradeSection(r) || <span className="text-muted">Sin sección</span>,
      sortValue: (r) => (r.grade_name ? `${r.grade_name} ${r.section_name}` : null),
    },
    {
      key: 'fault',
      header: 'Motivo / sanción',
      render: (r) => (
        <div className="sanction-cell">
          <div className="sanction-cell__head">
            <SeverityBadge severity={r.severity} />
            <strong>{r.fault_type}</strong>
          </div>
          <div className="sanction-cell__desc" title={r.description}>
            {r.description}
          </div>
          {r.measure && <div className="cell-person__sub">Medida: {r.measure}</div>}
        </div>
      ),
      sortValue: (r) => `${SEVERITY_KEYS.indexOf(r.severity)}-${r.fault_type}`,
    },
    {
      key: 'occurred_on',
      header: 'Fecha',
      render: (r) => (
        <div>
          <div style={{ whiteSpace: 'nowrap' }}>{day(r.occurred_on)}</div>
          <div className="cell-person__sub">
            {r.school_period_name}
            {r.term_id ? ` · ${termLabel(r.term_number, r.term_name)}` : ''}
          </div>
        </div>
      ),
      sortValue: (r) => r.occurred_on,
    },
  ];

  const severityFilter = (
    <div className="level-filter" role="group" aria-label="Filtrar por gravedad">
      {[['', 'Todas'], ...SEVERITY_KEYS.map((k) => [k, SEVERITIES[k].label])].map(([key, label]) => (
        <button
          key={key || 'all'}
          type="button"
          className={`level-filter__item ${severity === key ? 'level-filter__item--active' : ''}`}
          onClick={() => setSeverity(key)}
          aria-pressed={severity === key}
        >
          {label}
          <span className="level-filter__count">{key ? severityCounts[key] : forSeverity.length}</span>
        </button>
      ))}
    </div>
  );

  const selects = (
    <div className="filter-bar__selects">
      <Select value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Filtrar por grado" disabled={!gradeOptions.length}>
        <option value="">Todos los grados</option>
        {gradeOptions.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </Select>
      <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filtrar por sección" disabled={!sectionOptions.length}>
        <option value="">Todas las secciones</option>
        {sectionOptions.map((s) => (
          <option key={s} value={s}>
            Sección {s}
          </option>
        ))}
      </Select>
      <Select value={fault} onChange={(e) => setFault(e.target.value)} aria-label="Filtrar por tipo de falta" disabled={!faultOptions.length}>
        <option value="">Todos los tipos de falta</option>
        {faultOptions.map((f) => (
          <option key={f} value={f}>
            {f}
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

  const exportColumns = [
    { header: 'Alumno', value: fullName, width: 26 },
    { header: 'Cédula/Documento', value: (r) => r.national_id ?? '', width: 16 },
    { header: 'Grado', value: (r) => r.grade_name ?? '', width: 14 },
    { header: 'Sección', value: (r) => r.section_name ?? '', width: 10 },
    { header: 'Gravedad', value: (r) => SEVERITIES[r.severity]?.label ?? r.severity, width: 10 },
    { header: 'Tipo de falta', value: (r) => r.fault_type, width: 24 },
    { header: 'Motivo', value: (r) => r.description, width: 48 },
    { header: 'Medida', value: (r) => r.measure ?? '', width: 28 },
    { header: 'Fecha', value: (r) => r.occurred_on, width: 12 },
    { header: 'Año escolar', value: (r) => r.school_period_name ?? '', width: 14 },
    { header: 'Lapso', value: (r) => (r.term_id ? termLabel(r.term_number, r.term_name) : ''), width: 12 },
    { header: 'Registró', value: (r) => r.registered_by_name ?? '', width: 20 },
  ];

  return (
    <div>
      <PageHeader title="Convivencia" subtitle={SUBTITLE} />

      <DataTable
        title="Sanciones registradas"
        description="Faltas y medidas de todos los alumnos del colegio, de la más reciente a la más antigua."
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar por alumno, documento, falta o motivo…"
        getSearchText={(r) => [fullName(r), r.national_id, r.fault_type, r.description, r.measure, gradeSection(r)].join(' ')}
        filters={<div className="filter-bar">{severityFilter}</div>}
        searchAddons={selects}
        emptyMessage={anyFilter ? 'Ninguna sanción con esos filtros.' : 'Sin sanciones registradas.'}
        createLabel="Registrar sanción"
        onCreate={() => setEditing({})}
        canCreate={canCreate}
        headerActions={<ExportButton filename="sanciones" columns={exportColumns} rows={visible} />}
        onView={setViewing}
        onEdit={setEditing}
        canEdit={can('discipline', 'update')}
        onDelete={(r) => disciplineApi.remove(r.id)}
        canDelete={can('discipline', 'delete')}
        deleteConfirm={(r) => ({
          title: '¿Eliminar esta sanción?',
          message: `"${r.fault_type}" de ${fullName(r)}. Se borrará de su historial.`,
          confirmLabel: 'Eliminar',
        })}
        deleteSuccessMessage="Sanción eliminada"
        onDeleted={refetch}
        rowActions={[{ key: 'profile', icon: 'user', label: 'Ver ficha del alumno', onClick: (r) => navigate(`/students/${r.student_id}`) }]}
      />

      {viewing && (
        <Modal title="Detalle de la sanción" onClose={() => setViewing(null)}>
          <SanctionCard sanction={viewing} showStudent />
        </Modal>
      )}
      {modal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Docente: tarjetas (vista de siempre)
// ---------------------------------------------------------------------------

function TeacherDisciplineView() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [severity, setSeverity] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // búsqueda aplicada (con pausa al escribir)
  const { data, loading, error, refetch } = useFetch(() => disciplineApi.list({ severity: severity || undefined, q: q || undefined }), [severity, q]);
  const { canCreate, setEditing, modal } = useSanctionForm(refetch);

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const remove = async (s) => {
    const ok = await confirm({
      title: '¿Eliminar esta sanción?',
      message: `"${s.fault_type}" de ${s.first_name} ${s.last_name}. Se borrará de su historial.`,
      danger: true,
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await disciplineApi.remove(s.id);
      toast.success('Sanción eliminada');
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        title="Convivencia"
        subtitle={SUBTITLE}
        actions={
          canCreate && (
            <Button icon="plus" onClick={() => setEditing({})}>
              Registrar sanción
            </Button>
          )
        }
      />

      <div className="card data-table student-groups__toolbar">
        <div className="data-table__toolbar">
          <div className="input-group data-table__search">
            <Icon name="search" size={17} className="input-group__icon" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar alumno, documento o falta…" aria-label="Buscar" />
          </div>
          <div className="data-table__filters">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Gravedad">
              <option value="">Todas las gravedades</option>
              {SEVERITY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SEVERITIES[k].label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {data && <SeverityTotals totals={data.totals} />}
      </div>

      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : data?.items.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="shield" size={24} />
          </div>
          <div className="empty-state__title">{q || severity ? 'Sin resultados' : 'Sin sanciones registradas'}</div>
        </div>
      ) : (
        <div className="sanction-list sanction-list--grid">
          {data?.items.map((s) => (
            <SanctionCard
              key={s.id}
              sanction={s}
              showStudent
              studentLink={(x) => (
                <Link to={`/students/${x.student_id}`} className="cell-person__name">
                  {x.first_name} {x.last_name}
                </Link>
              )}
              onEdit={can('discipline', 'update') ? setEditing : undefined}
              onDelete={can('discipline', 'delete') ? remove : undefined}
            />
          ))}
        </div>
      )}

      {modal}
    </div>
  );
}

export default DisciplinePage;
