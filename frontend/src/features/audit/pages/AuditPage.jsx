import { useMemo, useState } from 'react';
import auditApi from '../../../api/endpoints/audit.api';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import AuditDetailDrawer from '../components/AuditDetailDrawer';
import { actionTone, dateTime, daysAgo, ipLabel } from '../auditFormat';

const PERIODS = [
  { key: '1', label: 'Hoy', days: 0 },
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
  { key: 'all', label: 'Todo', days: null },
];

const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/**
 * Auditoría (solo Administrador): bitácora de lo que se hizo en el sistema,
 * quién, cuándo y desde dónde. Clic en un evento → detalle en panel lateral.
 */
function AuditPage() {
  const [period, setPeriod] = useState('30');
  const [module, setModule] = useState('');
  const [userId, setUserId] = useState('');
  const [selected, setSelected] = useState(null);

  const days = PERIODS.find((p) => p.key === period).days;
  const params = { from: days === null ? undefined : daysAgo(days), module: module || undefined, userId: userId || undefined };
  const { data, loading, error } = useFetch(() => auditApi.list(params), [period, module, userId]);
  const { data: options } = useFetch(() => auditApi.options(), []);
  const rows = useMemo(() => data?.items || [], [data]);

  const columns = [
    {
      key: 'created_at',
      header: 'Fecha y hora',
      render: (r) => <span className="audit-date">{dateTime(r.created_at)}</span>,
      sortValue: (r) => r.created_at,
    },
    {
      key: 'actor',
      header: 'Usuario',
      render: (r) => (
        <div className="cell-person">
          <span className="audit-avatar" aria-hidden="true">
            {r.actor_name ? initials(r.actor_name) : <Icon name="settings" size={14} />}
          </span>
          <div>
            <div className="cell-person__name">{r.actor_name || 'Sistema'}</div>
            <div className="cell-person__sub">{r.actor_username || ipLabel(r.ip_address)}</div>
          </div>
        </div>
      ),
      sortValue: (r) => r.actor_name || '',
    },
    {
      key: 'module',
      header: 'Módulo',
      render: (r) => <Badge variant="neutral">{r.module_label}</Badge>,
      sortValue: (r) => r.module_label,
    },
    {
      key: 'action',
      header: 'Acción',
      render: (r) => (
        <div className="audit-action">
          <span className={`audit-dot audit-dot--${actionTone(r.action)}`} aria-hidden="true" />
          <div>
            <div className="cell-person__name">{r.action_label}</div>
            {r.summary && (
              <div className="cell-person__sub audit-action__summary" title={r.summary}>
                {r.summary}
              </div>
            )}
          </div>
        </div>
      ),
      sortValue: (r) => r.action_label,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Auditoría"
        subtitle="Bitácora de actividad del colegio: quién hizo qué, cuándo y desde dónde. Haz clic en un evento para ver todos sus detalles."
        actions={
          <span className="audit-only-admin">
            <Icon name="lock" size={14} /> Solo Administrador
          </span>
        }
      />

      {data?.has_more && (
        <Alert variant="info">Se muestran los {data.limit} eventos más recientes del período. Acota el período o filtra por módulo o usuario para ver los anteriores.</Alert>
      )}

      <DataTable
        title="Eventos registrados"
        description={data ? `${rows.length}${data.has_more ? '+' : ''} evento${rows.length === 1 ? '' : 's'} en el período.` : undefined}
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        pageSize={25}
        canCreate={false}
        onRowClick={setSelected}
        onView={setSelected}
        searchPlaceholder="Buscar por usuario, acción, detalle o IP…"
        getSearchText={(r) => [r.actor_name, r.actor_username, r.action, r.action_label, r.module_label, r.summary, r.ip_address].join(' ')}
        searchAddons={
          <div className="filter-bar__selects">
            <Select value={module} onChange={(e) => setModule(e.target.value)} aria-label="Módulo">
              <option value="">Todos los módulos</option>
              {(options?.modules || []).map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Usuario">
              <option value="">Todos los usuarios</option>
              {(options?.users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        }
        filters={
          <div className="segmented" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                className={`segmented__item ${period === p.key ? 'segmented__item--active' : ''}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
        emptyMessage="No hay eventos registrados con estos filtros."
      />

      {selected && <AuditDetailDrawer id={selected.id} preview={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default AuditPage;
