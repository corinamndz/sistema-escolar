import { useState } from 'react';
import notificationsApi from '../../../api/endpoints/notifications.api';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import DataTable from '../../../components/ui/DataTable';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { NOTIFICATION_ICONS, NOTIFICATION_TYPE_LABELS } from '../../../components/layout/NotificationBell';

const fullDate = (v) => new Date(v).toLocaleString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = (v) => new Date(v).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Tiempo entre el envío y la lectura: "12 min", "3 h", "2 d". */
function delay(from, to) {
  const min = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

/** Sustantivo del resumen según quiénes recibieron el aviso. */
function audienceNoun(stats, count) {
  const one = count === 1;
  if (stats.sent > 0 && stats.guardians.sent === stats.sent) return one ? 'representante' : 'representantes';
  if (stats.guardians.sent === 0) return one ? 'usuario del personal' : 'usuarios del personal';
  return one ? 'destinatario' : 'destinatarios';
}

const FILTERS = [
  { key: 'all', label: 'Todos' },
  { key: 'read', label: 'Leído' },
  { key: 'pending', label: 'Pendiente de lectura' },
];

/**
 * Detalle de un aviso del Centro de notificaciones: mensaje completo, fecha y
 * enlace. Con `canAudit` (Administración) agrega la trazabilidad de lectura:
 * cuántos lo leyeron de cuántos se envió y quién, con su rol y la hora exacta.
 */
function NotificationDetailDrawer({ notification: n, canAudit, onClose, onOpenLink }) {
  return (
    <Drawer title={n.title || NOTIFICATION_TYPE_LABELS[n.type] || 'Notificación'} icon={NOTIFICATION_ICONS[n.type] || 'bell'} size={canAudit ? 'lg' : undefined} onClose={onClose}>
      <div className="nd">
        <div className="nd__message">
          <div className="nd__meta">
            <Badge variant="neutral">{NOTIFICATION_TYPE_LABELS[n.type] || 'Aviso'}</Badge>
            <span>
              <Icon name="clock" size={13} /> Emitida el {fullDate(n.created_at)}
            </span>
          </div>
          <p className="nd__body">{n.body}</p>
          {n.link && (
            <Button size="sm" variant="secondary" onClick={() => onOpenLink(n)}>
              {n.data?.link_label || 'Ver detalle'} <Icon name="arrowRight" size={14} />
            </Button>
          )}
        </div>
        {canAudit && <ReadAudit id={n.id} />}
      </div>
    </Drawer>
  );
}

function ReadAudit({ id }) {
  const { data, loading, error } = useFetch(() => notificationsApi.audit(id), [id]);
  const [filter, setFilter] = useState('all');

  if (loading) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  const { stats, recipients, notification } = data;
  const rows = recipients.filter((r) => filter === 'all' || r.status === filter);
  const counts = { all: stats.sent, read: stats.read, pending: stats.pending };

  const columns = [
    {
      key: 'name',
      header: 'Usuario',
      render: (r) => (
        <div>
          <div className="cell-person__name">{r.name}</div>
          <div className="cell-person__sub">
            {r.username}
            {!r.user_active && ' · usuario inactivo'}
          </div>
        </div>
      ),
      sortValue: (r) => r.name,
    },
    {
      key: 'roles',
      header: 'Rol',
      render: (r) => (r.roles.length ? r.roles.join(', ') : r.is_guardian ? 'Representante' : '—'),
      sortValue: (r) => r.roles.join(', '),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (r) =>
        r.status === 'read' ? <Badge variant="success">Leído</Badge> : <Badge variant="warning">Pendiente</Badge>,
      sortValue: (r) => (r.status === 'read' ? 0 : 1),
    },
    {
      key: 'read_at',
      header: 'Leído el',
      render: (r) =>
        r.read_at ? (
          <div>
            <div className="nd__time">{shortDate(r.read_at)}</div>
            <div className="cell-person__sub">{r.late ? 'Acceso posterior al envío' : `${delay(notification.created_at, r.read_at)} después del envío`}</div>
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      sortValue: (r) => r.read_at || '',
    },
  ];

  return (
    <section className="nd__audit" aria-label="Trazabilidad de lectura">
      <h3 className="nd__title">
        <Icon name="eye" size={16} /> Trazabilidad de lectura
      </h3>

      {stats.sent === 0 ? (
        <Alert variant="info">Este aviso no tenía destinatarios con acceso al sistema cuando se envió.</Alert>
      ) : (
        <>
          <div className="nd__summary">
            <p className="nd__headline">
              Leído por <strong>{stats.read}</strong> de <strong>{stats.sent}</strong> {audienceNoun(stats, stats.sent)}
            </p>
            <div className="nd__bar" role="progressbar" aria-valuenow={stats.read_percent} aria-valuemin={0} aria-valuemax={100} aria-label="Porcentaje de lectura">
              <span style={{ width: `${stats.read_percent}%` }} />
            </div>
            <dl className="nd__stats">
              <div>
                <dt>Enviados</dt>
                <dd>{stats.sent}</dd>
              </div>
              <div>
                <dt>Leídos</dt>
                <dd className="is-read">{stats.read}</dd>
              </div>
              <div>
                <dt>Pendientes</dt>
                <dd className={stats.pending ? 'is-pending' : ''}>{stats.pending}</dd>
              </div>
              <div>
                <dt>Lectura</dt>
                <dd>{stats.read_percent.toLocaleString('es-VE')} %</dd>
              </div>
            </dl>
            {stats.guardians.sent > 0 && stats.staff.sent > 0 && (
              <p className="text-sm text-muted nd__split">
                Representantes: {stats.guardians.read} de {stats.guardians.sent} · Personal: {stats.staff.read} de {stats.staff.sent}
              </p>
            )}
            {stats.late > 0 && (
              <p className="text-sm text-muted nd__split">
                <Icon name="info" size={13} /> {stats.late} lo {stats.late === 1 ? 'leyó' : 'leyeron'} con un acceso creado después del envío; se cuenta{stats.late === 1 ? '' : 'n'} como destinatario{stats.late === 1 ? '' : 's'}.
              </p>
            )}
          </div>

          <DataTable
            bare
            columns={columns}
            rows={rows}
            rowKey="user_id"
            pageSize={10}
            canCreate={false}
            searchPlaceholder="Buscar destinatario…"
            getSearchText={(r) => [r.name, r.username, ...r.roles].join(' ')}
            filters={
              <div className="segmented" role="tablist" aria-label="Estado de lectura">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`segmented__item ${filter === f.key ? 'segmented__item--active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label} <span className="nd__chip">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            }
            emptyMessage={filter === 'pending' ? 'Todos lo leyeron.' : filter === 'read' ? 'Nadie lo ha leído todavía.' : 'Sin destinatarios.'}
          />
        </>
      )}
    </section>
  );
}

export default NotificationDetailDrawer;
