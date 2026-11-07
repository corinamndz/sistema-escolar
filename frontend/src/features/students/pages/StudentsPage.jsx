import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import studentsApi from '../../../api/endpoints/students.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { canManageAdmissions } from '../../../components/layout/navigation';
import { useAcademicYear } from '../../../context/AcademicYearContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import ImportButton from '../../../components/import/ImportButton';
import ExportButton from '../../../components/ui/ExportButton';
import { LEVEL_CODES, LevelBadge, LevelFilter } from '../../academics/levels';
import StudentGroups, { sectionLabel } from '../components/StudentGroups';
import AcademicHistoryDrawer from '../components/AcademicHistoryDrawer';
import EnrollmentFormsHistoryDrawer from '../components/EnrollmentFormsHistoryDrawer';
import LinksField, { linksChanged } from '../components/LinksField';
import paymentsApi from '../../../api/endpoints/payments.api';
import { formatMoney } from '../../payments/paymentStatus';
import { GENERAL_FEE_LABEL, describeFeePlan, effectiveFee, isExempt } from '../../payments/feePlans';

const STATUS_LABELS = { active: ['Activo', 'success'], inactive: ['Inactivo', 'neutral'], graduated: ['Egresado', 'primary'], withdrawn: ['Retirado', 'danger'] };
const STATUS_FILTERS = [
  ['', 'Todos'],
  ['active', 'Activos'],
  ['inactive', 'Inactivos'],
  ['graduated', 'Egresados'],
  ['withdrawn', 'Retirados'],
];
// Clave nueva: la vista inicial pasó a ser la tabla (la preferencia anterior era "Por sección").
const VIEW_KEY = 'students.view.v2';

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString('es', { timeZone: 'UTC' }) : null);
/** Mismo criterio que la búsqueda de DataTable: sin acentos ni mayúsculas. */
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = (r) => [fullName(r), r.national_id, r.grade_name, r.section_name && sectionLabel(r.section_name)].join(' ');

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'groups' ? 'groups' : 'list';
  } catch {
    return 'list';
  }
}

/**
 * Filtro rápido por estado, con el mismo estilo de "pastillas" que el filtro por nivel.
 * `children`: pastillas complementarias en el MISMO bloque, tras un divisor
 * (ej. «Tarifa especial»), para que todos los filtros quepan en una línea.
 */
function StatusFilter({ value, onChange, counts, total, children }) {
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
      {children && (
        <>
          <span className="level-filter__divider" aria-hidden="true" />
          {children}
        </>
      )}
    </div>
  );
}

/**
 * Filtro rápido de tarifa: pastilla que alterna «solo alumnos con tarifa
 * especial» (beca, convenio: students.fee_plan_id); sin marcar, se ven todos.
 * Va dentro del bloque de estados (StatusFilter), con su mismo estilo.
 */
function FeePill({ active, onChange, count }) {
  return (
    <button
      type="button"
      className={`level-filter__item ${active ? 'level-filter__item--active' : ''}`}
      onClick={() => onChange(!active)}
      aria-pressed={active}
      aria-label={`Solo alumnos con tarifa especial (${count})`}
      title="Alumnos con una tarifa distinta a la general de su nivel (becas, convenios)"
    >
      Tarifa especial
      <span className="level-filter__count">{count}</span>
    </button>
  );
}

/** Planilla del año en la celda «Inscripción» (cuando aún no figura inscrito). `order`: para ordenar la columna. */
const FORM_STATE = {
  missing: { label: 'Sin planilla', tone: 'muted', order: 0 },
  pending: { label: 'Planilla por llenar', tone: 'muted', order: 1 },
  rejected: { label: 'Planilla rechazada', tone: 'danger', order: 1 },
  changes_requested: { label: 'Planilla por corregir', tone: 'warn', order: 2 },
  submitted: { label: 'Planilla en revisión', tone: 'warn', order: 3 },
  approved: { label: 'Planilla aprobada', tone: 'ok', order: 4 },
};

/** Resultado de la matrícula de ese año cuando ya no está cursando (promoción, retiro). */
const OUTCOME_LABELS = { promoted: 'Promovido', retained: 'Repite', graduated: 'Egresado', withdrawn: 'Retirado' };

const countBy = (rows, key) => rows.reduce((acc, r) => (r[key] ? { ...acc, [r[key]]: (acc[r[key]] || 0) + 1 } : acc), {});

/**
 * Alumnos. Vista inicial: TABLA general (como Materias), con búsqueda y filtros
 * rápidos por estado y nivel educativo; acciones por fila: ver ficha, editar y
 * retirar / reactivar (los alumnos no se eliminan: se cambia su estado). La
 * vista "Por sección" agrupa la misma lista filtrada por grado y sección.
 */
function StudentsPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  // Se cargan todos los alumnos: los filtros (estado, nivel, grado, sección, búsqueda) son locales y muestran sus totales.
  // Año escolar GLOBAL (barra superior): grado, sección e inscripción de ese año.
  const { periodId: yearId } = useAcademicYear();
  const { data: rows, loading, error, refetch } = useFetch(() => studentsApi.list(yearId ? { enrollmentPeriodId: yearId } : undefined), [yearId]);
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [section, setSection] = useState(''); // nombre de la sección ("A"): sin grado, filtra la A de todos los grados
  const [specialFee, setSpecialFee] = useState(false); // solo alumnos con tarifa especial
  const [notEnrolled, setNotEnrolled] = useState(false); // solo alumnos NO inscritos en el año vigente
  const canSeeFees = can('payments', 'read');
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

  // Filtros acumulativos: estado + nivel + grado + sección (+ búsqueda de texto).
  // Cada grupo de pastillas cuenta sobre lo que dejan los DEMÁS filtros, y las
  // opciones de grado y sección salen de los alumnos que dejan los filtros previos.
  const all = rows || [];
  const matches = (r, skip) =>
    (skip === 'status' || !status || r.status === status) &&
    (skip === 'level' || !level || r.level_code === level) &&
    (skip === 'grade' || !gradeId || r.grade_id === gradeId) &&
    (skip === 'section' || !section || r.section_name === section) &&
    (skip === 'fee' || !specialFee || Boolean(r.fee_plan_id)) &&
    (skip === 'enroll' || !notEnrolled || r.enrollment_state !== 'enrolled');
  const forStatus = all.filter((r) => matches(r, 'status'));
  const forLevel = all.filter((r) => matches(r, 'level'));
  const specialFeeCount = all.filter((r) => matches(r, 'fee') && r.fee_plan_id).length;
  const notEnrolledCount = all.filter((r) => matches(r, 'enroll') && r.enrollment_state !== 'enrolled').length;
  const periodName = all[0]?.enrollment_period_name || null; // año del estatus (el mismo para todas las filas)
  const statusCounts = countBy(forStatus, 'status');
  const levelCounts = countBy(forLevel, 'level_code');
  const visible = all.filter((r) => matches(r));

  // Grados: los del nivel elegido, en orden de la jerarquía escolar.
  const gradeOptions = useMemo(() => {
    const map = new Map();
    all
      .filter((r) => r.grade_id && (!level || r.level_code === level))
      .forEach((r) => map.set(r.grade_id, { id: r.grade_id, name: r.grade_name, order: `${r.level_sort}-${String(r.grade_sort).padStart(3, '0')}-${r.grade_name}` }));
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order, 'es', { numeric: true }));
  }, [all, level]);
  // Secciones: las del grado elegido (o de todos los grados del nivel), por nombre.
  // Con el grado que sigue siendo válido: si el nivel lo dejó fuera, se calculan
  // como sin grado (si no, la sección elegida se perdería junto con el grado).
  const validGradeId = gradeOptions.some((g) => g.id === gradeId) ? gradeId : '';
  const sectionOptions = useMemo(
    () =>
      [...new Set(all.filter((r) => r.section_name && (!level || r.level_code === level) && (!validGradeId || r.grade_id === validGradeId)).map((r) => r.section_name))].sort((a, b) =>
        a.localeCompare(b, 'es', { numeric: true })
      ),
    [all, level, validGradeId]
  );
  // Un grado o sección que ya no está entre las opciones (cambió el nivel o el grado) se limpia.
  useEffect(() => {
    if (gradeId && !gradeOptions.some((g) => g.id === gradeId)) setGradeId('');
  }, [gradeId, gradeOptions]);
  useEffect(() => {
    if (section && !sectionOptions.includes(section)) setSection('');
  }, [section, sectionOptions]);
  const anyFilter = Boolean(status || level || gradeId || section || specialFee || notEnrolled);
  const clearFilters = () => {
    setSpecialFee(false);
    setNotEnrolled(false);
    setStatus('');
    setLevel('');
    setGradeId('');
    setSection('');
  };
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return q ? visible.filter((r) => normalize(searchText(r)).includes(q)) : visible;
  }, [visible, query]);

  const canEdit = can('students', 'update');

  /** Retirar o reactivar desde la fila (con confirmación). */
  const changeStatus = async (r, next) => {
    const withdraw = next === 'withdrawn';
    const ok = await confirm({
      title: withdraw ? `¿Retirar a ${fullName(r)}?` : `¿Reactivar a ${fullName(r)}?`,
      message: withdraw
        ? 'Quedará como Retirado. Su historial, notas e inscripciones se conservan, y puedes reactivarlo cuando quieras.'
        : 'Volverá a estar Activo.',
      danger: withdraw,
      confirmLabel: withdraw ? 'Retirar' : 'Reactivar',
    });
    if (!ok) return;
    try {
      await studentsApi.update(r.id, { status: next });
      toast.success(withdraw ? 'Alumno retirado' : 'Alumno reactivado', fullName(r));
      refetch();
    } catch (err) {
      toast.error('No se pudo cambiar el estado', getErrorMessage(err));
    }
  };

  // Historial académico: para cualquiera que vea alumnos (solo lectura).
  const [historyOf, setHistoryOf] = useState(null);
  const [formsOf, setFormsOf] = useState(null);
  const rowActions = [
    { key: 'history', icon: 'book', label: 'Historial académico', tone: 'view', onClick: (r) => setHistoryOf(r) },
    ...(canManageAdmissions(user) ? [{ key: 'forms', icon: 'clipboard', label: 'Historial de planillas', tone: 'view', onClick: (r) => setFormsOf(r) }] : []),
    ...(canEdit
      ? [
          { key: 'withdraw', icon: 'logout', label: 'Retirar alumno', show: (r) => r.status === 'active', onClick: (r) => changeStatus(r, 'withdrawn') },
          { key: 'reactivate', icon: 'checkCircle', label: 'Reactivar alumno', show: (r) => r.status !== 'active', onClick: (r) => changeStatus(r, 'active') },
        ]
      : []),
  ];

  const nameColumn = {
    key: 'name',
    header: 'Alumno',
    render: (r) => (
      <div>
        <Link to={`/students/${r.id}`} className="cell-person__name">
          {fullName(r)}
        </Link>
        {r.birth_date && <div className="cell-person__sub">Nac. {formatDate(r.birth_date)}</div>}
        {/* Acuerdo de pago (días de gracia): dato financiero, solo para quien ve Pagos. */}
        {canSeeFees && r.payment_grace_days && (
          <span className="agreement-chip" title={r.payment_agreement_note || 'Acuerdo de pago especial'}>
            <Icon name="calendar" size={12} /> Acuerdo de pago · +{r.payment_grace_days} días
          </span>
        )}
      </div>
    ),
    sortValue: (r) => `${r.last_name} ${r.first_name}`,
  };
  const documentColumn = { key: 'national_id', header: 'Cédula / documento', render: (r) => r.national_id || <span className="text-muted">—</span>, sortValue: (r) => r.national_id || '' };
  const statusColumn = {
    key: 'status',
    header: 'Estado',
    render: (r) => {
      const [label, variant] = STATUS_LABELS[r.status] || ['—', 'neutral'];
      return <Badge variant={variant}>{label}</Badge>;
    },
    sortValue: (r) => r.status,
  };
  // Inscripción en el año elegido: «Inscrito» SOLO con planilla aprobada de ese año (la matrícula sola no basta).
  const enrollmentColumn = {
    key: 'enrollment',
    header: periodName ? `Inscripción ${periodName}` : 'Inscripción',
    render: (r) => {
      const form = FORM_STATE[r.form_status || 'missing'];
      return (
        <div className="enroll-cell">
          {r.enrollment_state === 'enrolled' ? (
            <span className="enroll-badge enroll-badge--yes" title={`Planilla de ${periodName} aprobada`}>
              <Icon name="checkCircle" size={13} /> Inscrito
            </span>
          ) : (
            <span className="enroll-badge enroll-badge--no" title={`Para figurar inscrito necesita la planilla de ${periodName} aprobada`}>
              <Icon name="x" size={12} /> No inscrito
            </span>
          )}
          {r.enrollment_state !== 'enrolled' && (
            <span className={`enroll-cell__form enroll-cell__form--${form.tone}`}>
              {form.label}
              {r.period_grade_name && ` · ${r.period_grade_name}`}
            </span>
          )}
        </div>
      );
    },
    sortValue: (r) => (r.enrollment_state === 'enrolled' ? 9 : FORM_STATE[r.form_status || 'missing'].order),
  };
  const listColumns = [
    nameColumn,
    documentColumn,
    {
      key: 'section',
      header: periodName ? `Grado y sección ${periodName}` : 'Grado y sección',
      // Del año elegido. Si ese año ya cerró para el alumno (promovido, repite, retirado), se indica y a dónde pasa.
      render: (r) =>
        r.section_id ? (
          <div className="grade-cell">
            <span>{`${r.grade_name} · ${sectionLabel(r.section_name)}`}</span>
            {r.enrollment_status && r.enrollment_status !== 'active' && (
              <span className={`grade-cell__outcome grade-cell__outcome--${r.enrollment_status}`}>
                {OUTCOME_LABELS[r.enrollment_status] || r.enrollment_status}
                {r.next_grade_name && ` → ${r.next_grade_name} (${r.next_period_name})`}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted">{periodName ? `Sin inscripción en ${periodName}` : 'Sin inscripción'}</span>
        ),
      sortValue: (r) => (r.section_id ? `${r.level_sort}-${String(r.grade_sort).padStart(3, '0')}-${r.grade_name}-${r.section_name}` : '~'),
    },
    {
      key: 'level',
      header: 'Nivel',
      render: (r) => (r.level_code ? <LevelBadge code={r.level_code} /> : <span className="text-muted">—</span>),
      sortValue: (r) => (r.level_code ? LEVEL_CODES.indexOf(r.level_code) : 9),
    },
    enrollmentColumn,
    statusColumn,
  ];

  const canCreate = can('students', 'create');
  const importButton = canCreate && (
    <ImportButton
      type="students"
      title="Importar alumnos desde Excel"
      description="Incluye grado y sección para inscribirlos en el año activo, y la cédula de un representante ya registrado para vincularlo."
      onImported={refetch}
    />
  );

  const exportColumns = [
    { header: 'Nombre',            value: (r) => r.first_name,                      width: 18 },
    { header: 'Apellido',          value: (r) => r.last_name,                       width: 18 },
    { header: 'Cédula/Documento',  value: (r) => r.national_id ?? '',               width: 16 },
    { header: 'Grado',             value: (r) => r.grade_name ?? '',                width: 16 },
    { header: 'Sección',           value: (r) => r.section_name ? sectionLabel(r.section_name) : '', width: 12 },
    { header: 'Nivel',             value: (r) => r.level_code ? { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' }[r.level_code] ?? r.level_code : '', width: 14 },
    { header: 'Estado',            value: (r) => STATUS_LABELS[r.status]?.[0] ?? r.status, width: 12 },
    { header: 'Año escolar',       value: (r) => r.school_period_name ?? '',        width: 16 },
    { header: `Inscripción ${periodName || ''}`.trim(), value: (r) => (r.enrollment_state === 'enrolled' ? 'Inscrito' : `No inscrito · ${FORM_STATE[r.form_status || 'missing'].label.toLowerCase()}`), width: 30 },
    { header: 'Fecha de nacimiento', value: (r) => r.birth_date ? r.birth_date.slice(0, 10) : '', width: 18 },
  ];
  const exportButton = (
    <ExportButton filename="alumnos" columns={exportColumns} rows={filtered} />
  );
  // Fila de arriba, junto al buscador: grado, sección y limpiar filtros.
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
  // Fila de abajo: pastillas de estado (+ tarifa especial) y nivel, en una sola línea
  // flexible (filter-bar: flex + wrap; --compact ajusta el espaciado para que quepan).
  const filters = (
    <div className="filter-bar filter-bar--compact">
      <StatusFilter value={status} onChange={setStatus} counts={statusCounts} total={forStatus.length}>
        {/* Dato financiero: solo para quien ve Pagos. */}
        {canSeeFees && <FeePill active={specialFee} onChange={setSpecialFee} count={specialFeeCount} />}
        <button
          type="button"
          className={`level-filter__item ${notEnrolled ? 'level-filter__item--active' : ''}`}
          onClick={() => setNotEnrolled((v) => !v)}
          aria-pressed={notEnrolled}
          title={`Alumnos sin inscripción en ${periodName || 'el año vigente'}`}
        >
          No inscritos
          <span className="level-filter__count">{notEnrolledCount}</span>
        </button>
      </StatusFilter>
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
      <PageHeader title="Alumnos" subtitle="Matrícula del colegio: busca, filtra por estado, nivel, grado o sección y abre la ficha de cada alumno." actions={viewToggle} />

      {view === 'list' ? (
        <DataTable
          title="Alumnos del colegio"
          description={`Grado, sección e inscripción del año escolar ${periodName || 'vigente'}: cada año tiene su propio registro.`}
          columns={listColumns}
          rows={visible}
          loading={loading}
          error={error}
          searchPlaceholder="Buscar por nombre, apellido, documento, grado o sección…"
          getSearchText={searchText}
          filters={filters}
          searchAddons={gradeSectionFilters}
          emptyMessage={anyFilter ? 'Ningún alumno con esos filtros.' : 'Aún no hay alumnos registrados.'}
          createLabel="Nuevo alumno"
          onCreate={() => setEditing({})}
          canCreate={canCreate}
          headerActions={<>{importButton}{exportButton}</>}
          // "Ver" abre la ficha completa (representantes, sección actual), que ya es una página propia.
          onView={(r) => navigate(`/students/${r.id}`)}
          onEdit={setEditing}
          canEdit={canEdit}
          // Sin eliminar: el backend no expone DELETE /students/:id; se retira (cambia el estado).
          rowActions={rowActions}
        />
      ) : (
        <>
          <div className="card data-table student-groups__toolbar">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  Matrícula por grado y sección
                  {!loading && rows && <span className="data-table__count">{filtered.length}</span>}
                </h3>
                <p className="card__subtitle">Cada grupo muestra los alumnos inscritos en esa sección del año escolar vigente.</p>
              </div>
              <div className="data-table__header-actions">
                {importButton}
                {exportButton}
                {canCreate && (
                  <Button icon="plus" onClick={() => setEditing({})}>
                    Nuevo alumno
                  </Button>
                )}
              </div>
            </div>
            {/* Misma distribución que la tabla: buscador + grado/sección arriba, pastillas abajo. */}
            <div className="data-table__toolbar data-table__toolbar--stacked">
              <div className="data-table__search-row">
                <div className="input-group data-table__search">
                  <Icon name="search" size={17} className="input-group__icon" />
                  <input
                    type="search"
                    className="input"
                    placeholder="Buscar por nombre, apellido, documento, grado o sección…"
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
                <div className="data-table__search-addons">{gradeSectionFilters}</div>
              </div>
              <div className="data-table__filters">
                {filters}
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
              <div className="empty-state__title">{query || anyFilter ? 'Sin resultados' : 'Aún no hay alumnos registrados.'}</div>
              {query && <div className="text-sm">Ningún alumno coincide con “{query}”.</div>}
            </div>
          ) : (
            <StudentGroups
              rows={filtered}
              columns={[nameColumn, documentColumn, enrollmentColumn, statusColumn]}
              searching={Boolean(query)}
              // Cupos solo tienen sentido sin filtros (con filtro, el conteo no es la matrícula de la sección).
              showCapacity={!anyFilter && !query}
              collapseSignal={collapseSignal}
              onView={(r) => navigate(`/students/${r.id}`)}
              onEdit={setEditing}
              canEdit={canEdit}
              rowActions={rowActions}
            />
          )}
        </>
      )}

      {editing !== null && <StudentFormModal initial={editing} onClose={() => setEditing(null)} onSaved={refetch} />}
      {historyOf && <AcademicHistoryDrawer student={historyOf} onClose={() => setHistoryOf(null)} />}
      {formsOf && <EnrollmentFormsHistoryDrawer student={formsOf} onClose={() => setFormsOf(null)} />}
    </div>
  );
}

/** Opción del selector de representantes: nombre, contacto y cédula. */
const guardianOption = (g) => ({
  id: g.id,
  label: `${g.first_name} ${g.last_name}`,
  sub: [g.national_id, g.phone, g.email].filter(Boolean).join(' · ') || 'Sin datos de contacto',
  search: `${g.national_id || ''} ${g.email || ''} ${g.phone || ''}`,
});

function StudentFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const { can } = useAuth();
  // Para elegir representantes hay que poder verlos (el backend lo exige igual).
  const canLinkGuardians = can('guardians', 'read');
  const { data: guardians } = useFetch(() => (canLinkGuardians ? studentsApi.listGuardians() : Promise.resolve([])), [canLinkGuardians]);
  const { data: detail, loading: loadingDetail } = useFetch(
    () => (isEdit && canLinkGuardians ? studentsApi.getOne(initial.id) : Promise.resolve(null)),
    [initial.id, canLinkGuardians]
  );
  const originalLinks = useMemo(
    () => (detail?.guardians || []).map((g) => ({ id: g.id, relationship: g.relationship || '', isPrimary: Boolean(g.is_primary) })),
    [detail]
  );
  const [links, setLinks] = useState(null);
  useEffect(() => {
    if (links === null && (!isEdit || detail || !canLinkGuardians)) setLinks(originalLinks);
  }, [links, isEdit, detail, canLinkGuardians, originalLinks]);
  const guardianOptions = useMemo(() => (guardians || []).map(guardianOption), [guardians]);
  const [form, setForm] = useState({
    firstName: initial.first_name || '',
    lastName: initial.last_name || '',
    birthDate: initial.birth_date ? initial.birth_date.slice(0, 10) : '',
    nationalId: initial.national_id || '',
    status: initial.status || 'active',
    // '' = tarifa general del nivel (valor por defecto); si no, id de una tarifa especial.
    feePlanId: initial.fee_plan_id || '',
  });
  // Tarifa aplicable: la ve quien ve Pagos y la cambia quien los administra (el backend lo exige igual).
  const canSeeFees = can('payments', 'read');
  const canEditFee = can('payments', 'update');
  const { data: feePlans } = useFetch(() => (canSeeFees ? paymentsApi.listFeePlans() : Promise.resolve([])), [canSeeFees]);
  // Al editar: tarifa base de su nivel en el año en curso (para mostrar el monto de cada opción).
  const { data: currentFee } = useFetch(
    () => (isEdit && canSeeFees ? paymentsApi.studentFee(initial.id) : Promise.resolve(null)),
    [initial.id, canSeeFees]
  );
  const baseFee = currentFee?.base?.amount ?? null;
  const originalFeePlanId = initial.fee_plan_id || '';
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
    // Tarifa: solo si cambió (null = volver a la tarifa general del nivel).
    if (canEditFee && form.feePlanId !== originalFeePlanId) data.feePlanId = form.feePlanId || null;
    // Representantes: lista completa, solo si cambió (el backend aplica la diferencia).
    if (canLinkGuardians && links && (isEdit ? linksChanged(originalLinks, links) : links.length > 0)) {
      data.guardians = links.map((l) => ({ guardianId: l.id, relationship: l.relationship || null, isPrimary: l.isPrimary }));
    }
    try {
      const saved = await run(data);
      const a = saved?.fee_applied;
      const recalculated = a ? a.updated + a.cancelled + a.reactivated : 0;
      toast.success(
        isEdit ? 'Cambios guardados' : 'Alumno registrado',
        `${form.firstName} ${form.lastName}${recalculated ? ` · tarifa aplicada a ${recalculated === 1 ? '1 mensualidad pendiente' : `${recalculated} mensualidades pendientes`}` : ''}`
      );
      onSaved();
      onClose();
    } catch {
      // el error queda visible en el modal
    }
  };

  return (
    <Drawer title={isEdit ? 'Editar alumno' : 'Nuevo alumno'} onClose={onClose} size={canLinkGuardians ? 'lg' : undefined}>
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
          {canSeeFees && (
            <Field
              label="Tarifa aplicable"
              error={fieldErrors.feePlanId}
              hint={
                !canEditFee
                  ? 'Solo quien administra Pagos puede cambiarla.'
                  : form.feePlanId !== originalFeePlanId && isEdit
                    ? 'Se aplicará a sus mensualidades pendientes desde el mes en curso.'
                    : isEdit
                      ? 'Para una beca o convenio, elige la tarifa especial.'
                      : 'Por defecto paga la tarifa de su nivel al inscribirse.'
              }
            >
              <Select name="feePlanId" value={form.feePlanId} onChange={handleChange} disabled={!canEditFee}>
                <option value="">
                  {GENERAL_FEE_LABEL}
                  {baseFee !== null ? ` (${formatMoney(baseFee, 'USD')})` : ''}
                </option>
                {(feePlans || []).map((p) => {
                  const amount = effectiveFee(baseFee, p);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} — {isExempt(p) ? 'exonerado' : amount !== null && p.kind === 'percentage' ? `${describeFeePlan(p)} (${formatMoney(amount, 'USD')})` : describeFeePlan(p)}
                    </option>
                  );
                })}
              </Select>
            </Field>
          )}
          {canLinkGuardians && (
            <Field
              label="Representantes"
              error={fieldErrors.guardians}
              hint="Busca por nombre, cédula, teléfono o correo. El primero que agregues queda como principal; puedes cambiarlo."
              full
            >
              {links === null || (isEdit && loadingDetail) ? (
                <Spinner />
              ) : (
                <LinksField
                  options={guardianOptions}
                  links={links}
                  onChange={setLinks}
                  primaryMode="single"
                  placeholder="Buscar representante por nombre, cédula o correo…"
                  emptyText="Ningún representante coincide con"
                />
              )}
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
    </Drawer>
  );
}

export default StudentsPage;
