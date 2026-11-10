import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import carryoversApi from '../../../api/endpoints/carryovers.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import CarryoverDrawer from '../components/CarryoverDrawer';
import { CARRYOVER_STATUS, MomentDots, fmtGrade } from '../components/MomentTimeline';

const FILTERS = [
  ['open', 'Abiertas'],
  ['unassigned', 'Sin profesor'],
  ['passed', 'Aprobadas'],
  ['failed', 'No aprobadas'],
  ['closed', 'Suspendidas y anuladas'],
  ['all', 'Todas'],
];
const matches = (c, f) =>
  ({
    open: ['pending', 'in_progress'].includes(c.status),
    unassigned: ['pending', 'in_progress'].includes(c.status) && !c.teacher_id,
    passed: c.status === 'passed',
    failed: c.status === 'failed',
    closed: ['suspended', 'cancelled'].includes(c.status),
    all: true,
  })[f];

/**
 * Materias pendientes (arrastres). La dirección y la coordinación asignan
 * profesor y auditan el avance; el profesor ve solo las suyas, diseña los momentos
 * y califica.
 */
function CarryoversPage() {
  const { data, loading, error, refetch } = useFetch(() => carryoversApi.list(), []);
  const canManage = Boolean(data?.can_manage);
  const { data: teachers } = useFetch(() => (canManage ? carryoversApi.teachers() : Promise.resolve([])), [canManage]);
  const [filter, setFilter] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const toast = useToast();

  const items = useMemo(() => data?.items || [], [data]);
  const candidates = data?.candidates || [];
  const rows = items.filter((c) => matches(c, filter));
  const current = items.find((c) => c.id === openId) || null;

  const assign = async (c, teacherId) => {
    try {
      await carryoversApi.assignTeacher(c.id, teacherId || null);
      toast.success(teacherId ? 'Profesor asignado' : 'Profesor quitado', c.subject_name);
      refetch();
    } catch (err) {
      toast.error('No se pudo asignar', getErrorMessage(err));
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { opened } = await carryoversApi.sync();
      toast.success('Materias pendientes abiertas', `${opened} materia${opened === 1 ? '' : 's'}`);
      refetch();
    } catch (err) {
      toast.error('No se pudieron abrir', getErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const columns = [
    {
      key: 'student',
      header: 'Alumno',
      render: (c) => (
        <div>
          <span className="cell-person__name">
            {c.first_name} {c.last_name}
          </span>
          <div className="cell-person__sub">{c.current_grade_name ? `Cursa ${c.current_grade_name} ${c.current_section_name} · ${c.current_period_name}` : 'Sin año actual'}</div>
        </div>
      ),
      sortValue: (c) => `${c.last_name} ${c.first_name}`,
    },
    {
      key: 'subject',
      header: 'Materia pendiente',
      render: (c) => (
        <div>
          <strong>{c.subject_name}</strong>
          <div className="cell-person__sub">
            {c.source_grade_name} · {c.source_period_name} · nota {fmtGrade(c.source_final_grade)}
          </div>
        </div>
      ),
      sortValue: (c) => c.subject_name,
    },
    {
      key: 'teacher',
      header: 'Profesor',
      render: (c) =>
        canManage && ['pending', 'in_progress', 'failed'].includes(c.status) ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Select sorted value={c.teacher_id || ''} onChange={(e) => assign(c, e.target.value)} aria-label={`Profesor de ${c.subject_name} de ${c.first_name} ${c.last_name}`}>
              <option value="">Sin asignar</option>
              {(teachers || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.first_name} {t.last_name}
                </option>
              ))}
            </Select>
          </span>
        ) : (
          c.teacher_name || <span className="text-muted">Sin asignar</span>
        ),
      sortValue: (c) => c.teacher_name || '',
    },
    { key: 'moments', header: 'Avance', render: (c) => <MomentDots moments={c.moments} />, sortValue: (c) => c.moments.filter((m) => m.grade !== null).length },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => {
        const s = CARRYOVER_STATUS[c.status];
        return (
          <Badge variant={s.variant}>
            {s.label}
            {c.status === 'passed' ? ` · ${fmtGrade(c.final_grade)}` : ''}
          </Badge>
        );
      },
      sortValue: (c) => c.status,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Materias pendientes"
        subtitle={canManage ? 'Arrastres de los alumnos promovidos: asigna el profesor y sigue el avance de sus momentos de recuperación.' : 'Las materias que tienes asignadas: diseña los momentos y califica a cada alumno.'}
        actions={
          <Link to="/carryovers/simulator" className="btn btn--secondary">
            <Icon name="sparkles" size={16} /> Simulador
          </Link>
        }
      />
      <Alert>{error}</Alert>

      {canManage && candidates.length > 0 && (
        <div className="cm-banner">
          <Icon name="info" size={17} />
          <span>
            <strong>{candidates.length} materia{candidates.length === 1 ? '' : 's'} reprobada{candidates.length === 1 ? '' : 's'}</strong> de alumnos ya promovidos sin materia pendiente abierta
            {candidates.length <= 3 ? `: ${candidates.map((x) => `${x.subject_name} (${x.first_name} ${x.last_name})`).join(', ')}.` : '.'}
          </span>
          <Button size="sm" onClick={sync} loading={syncing}>
            Abrirlas
          </Button>
        </div>
      )}

      <DataTable
        title="Materias pendientes"
        columns={columns}
        rows={rows}
        loading={loading}
        rowKey={(c) => c.id}
        getSearchText={(c) => `${c.first_name} ${c.last_name} ${c.subject_name} ${c.teacher_name || ''}`}
        filters={
          <div className="filter-bar">
            <div className="level-filter" role="group" aria-label="Filtrar por estado">
              {FILTERS.filter(([k]) => canManage || k !== 'unassigned').map(([k, label]) => (
                <button key={k} type="button" className={`level-filter__item ${filter === k ? 'level-filter__item--active' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
                  {label}
                  <span className="level-filter__count">{items.filter((c) => matches(c, k)).length}</span>
                </button>
              ))}
            </div>
          </div>
        }
        emptyMessage={items.length ? 'Ninguna materia con ese filtro.' : canManage ? 'No hay materias pendientes. Se abren solas al promover a un alumno con materias reprobadas.' : 'No tienes materias pendientes asignadas.'}
        canCreate={false}
        onRowClick={(c) => setOpenId(c.id)}
        rowActions={[{ key: 'open', icon: 'eye', label: 'Ver plan especial', tone: 'view', onClick: (c) => setOpenId(c.id) }]}
        pageSize={25}
      />

      {current && <CarryoverDrawer carryover={current} canManage={canManage} onClose={() => setOpenId(null)} onChanged={refetch} />}
    </div>
  );
}

export default CarryoversPage;
