import { useMemo, useState } from 'react';
import DataTable from '../../../components/ui/DataTable';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import ExportButton from '../../../components/ui/ExportButton';

const STATUS = {
  confirmed: { label: 'Confirmado', variant: 'success' },
  outdated: { label: 'Versión anterior', variant: 'warning' },
  pending: { label: 'Pendiente', variant: 'neutral' },
  no_access: { label: 'Sin acceso al portal', variant: 'danger' },
};
const FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'confirmed', label: 'Confirmados' },
  { key: 'pending', label: 'Pendientes' },
  { key: 'outdated', label: 'Versión anterior' },
  { key: 'no_access', label: 'Sin acceso' },
];

const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('es', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** "0/3": alumnos con al menos un representante que confirmó / alumnos. Para el botón de la cabecera del plan. */
export const acknowledgmentRatio = (data) => (data ? `${data.totals.students_confirmed}/${data.totals.students}` : null);

/**
 * Reporte de lecturas (069): por alumno de las secciones del plan y por cada
 * representante, si confirmó "He leído y acepto el plan de evaluación", cuándo
 * y desde qué IP. Para Dirección y el docente del plan; exportable a Excel.
 * Se muestra en un panel lateral desde la cabecera del plan, que es quien lo carga
 * (el botón ya necesita los totales).
 */
function PlanAcknowledgments({ data, loading, error, planTitle }) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => (data?.items || []).filter((r) => !filter || r.status === filter), [data, filter]);
  const t = data?.totals;

  const columns = [
    // Compacta para el panel lateral: la sección va bajo el alumno y la IP bajo la fecha.
    {
      key: 'student',
      header: 'Alumno',
      render: (r) => (
        <div>
          <div className="cell-person__name">{r.student_name}</div>
          <div className="cell-person__sub">Sección {r.section_name}</div>
        </div>
      ),
      sortValue: (r) => r.student_name,
    },
    {
      key: 'guardian',
      header: 'Representante',
      render: (r) => (
        <div>
          <div className="cell-person__name">{r.guardian_name}</div>
          <div className="cell-person__sub">{[r.relationship, r.guardian_email].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      ),
      sortValue: (r) => r.guardian_name,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (r) => <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>,
      sortValue: (r) => Object.keys(STATUS).indexOf(r.status),
    },
    {
      key: 'when',
      header: 'Confirmado el',
      render: (r) =>
        r.acknowledged_at ? (
          <div>
            <div>{dateTime(r.acknowledged_at)}</div>
            {r.ip_address && (
              <div className="cell-person__sub">
                IP <code className="plan-ack-report__ip">{r.ip_address}</code>
              </div>
            )}
            {r.confirmations > 1 && <div className="cell-person__sub">{r.confirmations} confirmaciones (historial)</div>}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      sortValue: (r) => r.acknowledged_at || '',
    },
  ];

  const exportColumns = [
    { header: 'Alumno', value: (r) => r.student_name, width: 30 },
    { header: 'Sección', value: (r) => r.section_name, width: 10 },
    { header: 'Representante', value: (r) => r.guardian_name, width: 30 },
    { header: 'Parentesco', value: (r) => r.relationship || '', width: 14 },
    { header: 'Correo', value: (r) => r.guardian_email || '', width: 30 },
    { header: 'Estado', value: (r) => STATUS[r.status].label, width: 20 },
    { header: 'Fecha y hora de confirmación', value: (r) => dateTime(r.acknowledged_at), width: 24 },
    { header: 'IP', value: (r) => r.ip_address || '', width: 18 },
    { header: 'Navegador', value: (r) => r.user_agent || '', width: 40 },
  ];

  return (
    <div className="plan-ack-report">
      {data && !data.published && (
        <Alert variant="info">Las familias todavía no ven este plan (falta la aprobación de coordinación): podrán confirmarlo cuando se publique.</Alert>
      )}
      {t && (
        <div className="plan-ack-report__summary">
          <div className="plan-ack-report__big">
            <strong>
              {t.students_confirmed}/{t.students}
            </strong>
            <span>alumnos con al menos un representante que confirmó</span>
          </div>
          <span className="plan-ack-report__chip is-ok">{t.confirmed} confirmados</span>
          <span className="plan-ack-report__chip">{t.pending} pendientes</span>
          {t.outdated > 0 && <span className="plan-ack-report__chip is-warn">{t.outdated} de una versión anterior</span>}
          {t.no_access > 0 && <span className="plan-ack-report__chip is-danger">{t.no_access} sin acceso al portal</span>}
        </div>
      )}
      <DataTable
        bare
        columns={columns}
        rows={rows}
        loading={loading}
        error={error}
        searchPlaceholder="Buscar alumno o representante…"
        getSearchText={(r) => [r.student_name, r.guardian_name, r.guardian_email, r.section_name].join(' ')}
        searchAddons={<ExportButton filename={`confirmaciones-${planTitle || 'plan'}`} columns={exportColumns} rows={rows} />}
        filters={
          <div className="level-filter" role="group" aria-label="Filtrar por estado">
            {FILTERS.map((f) => (
              <button
                key={f.key || 'all'}
                type="button"
                className={`level-filter__item ${filter === f.key ? 'level-filter__item--active' : ''}`}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}
                {t && <span className="level-filter__count">{f.key ? t[f.key] : t.total}</span>}
              </button>
            ))}
          </div>
        }
        emptyMessage={filter ? 'Nadie en este estado.' : 'No hay alumnos con representantes en las secciones de este plan.'}
      />
    </div>
  );
}

export default PlanAcknowledgments;
