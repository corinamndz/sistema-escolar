import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import notificationsApi from '../../../api/endpoints/notifications.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { NOTIFICATION_ICONS, NOTIFICATION_TYPE_LABELS } from '../../../components/layout/NotificationBell';
import { NOTIFICATIONS_REFRESH, refreshNotifications } from '../../../lib/notificationEvents';
import { daysAgo } from '../../audit/auditFormat';
import { useAuth } from '../../../context/AuthContext';
import NotificationDetailDrawer from '../components/NotificationDetailDrawer';

const PAGE_SIZE = 20;
const STATUSES = [
  { key: 'all', label: 'Todas' },
  { key: 'unread', label: 'No leídas' },
  { key: 'read', label: 'Leídas' },
];
const PERIODS = [
  { key: 'all', label: 'Todo' },
  { key: '0', label: 'Hoy', days: 0 },
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
  { key: 'custom', label: 'Rango…' },
];

const dayHeading = (value) => {
  const d = new Date(value);
  const key = (x) => x.toDateString();
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (key(d) === key(today)) return 'Hoy';
  if (key(d) === key(yesterday)) return 'Ayer';
  const text = d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const timeOf = (value) => new Date(value).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

/** Agrupa por día (la lista ya viene de la más reciente a la más antigua). */
function byDay(items) {
  const groups = [];
  for (const n of items) {
    const label = dayHeading(n.created_at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(n);
  }
  return groups;
}

/**
 * Centro de notificaciones: historial completo de los avisos del usuario (los
 * de la campana y los anteriores), con filtros por estado, fecha y tipo,
 * "Marcar todas como leídas" y el enlace de cada aviso al recurso relacionado.
 */
function NotificationCenterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  // Cualquier cambio de filtro vuelve a la primera página.
  const [status, setStatusRaw] = useState('all');
  const [period, setPeriodRaw] = useState('all');
  const [range, setRangeRaw] = useState({ from: '', to: '' });
  const [type, setTypeRaw] = useState('');
  const resetting = (setter) => (value) => {
    setPage(1);
    setter(value);
  };
  const [setStatus, setPeriod, setRange, setType] = [resetting(setStatusRaw), resetting(setPeriodRaw), resetting(setRangeRaw), resetting(setTypeRaw)];
  const [marking, setMarking] = useState(false);
  const [selected, setSelected] = useState(null);
  const { can, user } = useAuth();
  // Trazabilidad de lectura: mismo acceso que el Log de notificaciones.
  const canAudit = can('tenant_settings', 'read') && !user?.isRestrictedTeacher;

  const preset = PERIODS.find((p) => p.key === period);
  const from = period === 'custom' ? range.from : preset.days !== undefined ? daysAgo(preset.days) : '';
  const to = period === 'custom' ? range.to : '';
  const rangeError = period === 'custom' && range.from && range.to && range.from > range.to ? 'La fecha final debe ser igual o posterior a la inicial.' : null;

  const params = { status, from, to, type, page, pageSize: PAGE_SIZE };
  const { data, setData, loading, error, refetch } = useFetch(
    () => (rangeError ? Promise.resolve(null) : notificationsApi.history(params)),
    [status, from, to, type, page, rangeError]
  );

  // Al marcar (aquí o en la campana) se emite NOTIFICATIONS_REFRESH: esta vista se recarga.
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_REFRESH, refetch);
    return () => window.removeEventListener(NOTIFICATIONS_REFRESH, refetch);
  }, [refetch]);

  const markLocal = (pred) =>
    setData((d) => {
      if (!d) return d;
      const newlyRead = d.items.filter((n) => !n.read && pred(n)).length;
      return { ...d, items: d.items.map((n) => (pred(n) ? { ...n, read: true } : n)), unread_count: Math.max(0, d.unread_count - newlyRead) };
    });

  const markRead = async (n) => {
    if (n.read) return;
    markLocal((x) => x.id === n.id);
    try {
      await notificationsApi.markRead(n.id);
      refreshNotifications(); // la campana baja su contador y esta lista se recarga
    } catch (err) {
      toast.error('No se pudo marcar como leída', getErrorMessage(err));
      refetch();
    }
  };

  const markAll = async () => {
    setMarking(true);
    try {
      const { marked } = await notificationsApi.markAllRead();
      toast.success('Todo al día', marked ? `${marked} notificación${marked === 1 ? '' : 'es'} marcada${marked === 1 ? '' : 's'} como leída${marked === 1 ? '' : 's'}.` : 'No había notificaciones sin leer.');
      refreshNotifications();
    } catch (err) {
      toast.error('No se pudieron marcar', getErrorMessage(err));
    } finally {
      setMarking(false);
    }
  };

  const open = (n) => {
    markRead(n);
    navigate(n.link);
  };
  // Abrir el detalle cuenta como lectura (queda registrada su hora en la trazabilidad).
  const showDetail = (n) => {
    markRead(n);
    setSelected(n);
  };

  const items = data?.items || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const anyFilter = status !== 'all' || period !== 'all' || type;
  const clearFilters = () => {
    setStatus('all');
    setPeriod('all');
    setRange({ from: '', to: '' });
    setType('');
  };
  const setRangeField = (field) => (e) => setRange({ ...range, [field]: e.target.value });

  return (
    <div>
      <PageHeader
        title="Centro de notificaciones"
        subtitle="Todos tus avisos: pagos, eventos, planes de evaluación, revisiones y más."
        actions={
          <Button icon="checkCircle" variant="secondary" onClick={markAll} loading={marking} disabled={!data?.unread_count}>
            Marcar todas como leídas
          </Button>
        }
      />

      <div className="card nc">
        <div className="nc__toolbar">
          <div className="segmented" role="tablist" aria-label="Estado">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={status === s.key}
                className={`segmented__item ${status === s.key ? 'segmented__item--active' : ''}`}
                onClick={() => setStatus(s.key)}
              >
                {s.label}
                {s.key === 'unread' && data?.unread_count > 0 && <span className="nc__count">{data.unread_count}</span>}
              </button>
            ))}
          </div>
          <div className="filter-bar__selects">
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de aviso">
              <option value="">Todos los tipos</option>
              {/* Revisión académica agrupa dos tipos: se muestran por su etiqueta, sin repetir. */}
              {(data?.types || []).map((t) => (
                <option key={t} value={t}>
                  {NOTIFICATION_TYPE_LABELS[t] || t}
                  {t === 'review_request' ? ' · solicitudes' : t === 'review_result' ? ' · resultados' : ''}
                </option>
              ))}
            </Select>
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key === 'all' ? 'Cualquier fecha' : p.key === 'custom' ? 'Rango de fechas…' : p.key === '0' ? 'Hoy' : `Últimos ${p.label}`}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {period === 'custom' && (
          <div className="nc__range">
            <label>
              Desde
              <Input type="date" value={range.from} max={range.to || undefined} onChange={setRangeField('from')} />
            </label>
            <label>
              Hasta
              <Input type="date" value={range.to} min={range.from || undefined} onChange={setRangeField('to')} />
            </label>
          </div>
        )}

        <Alert>{rangeError || error}</Alert>

        {loading && !data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className="empty-state nc__empty">
            <div className="empty-state__icon">
              <Icon name={anyFilter ? 'search' : 'checkCircle'} size={22} />
            </div>
            <div className="empty-state__title">{anyFilter ? 'Sin notificaciones con estos filtros' : 'Aún no tienes notificaciones'}</div>
            {anyFilter && (
              <button type="button" className="link-button" onClick={clearFilters}>
                Quitar filtros
              </button>
            )}
          </div>
        ) : (
          <div className={`nc__list ${loading ? 'is-loading' : ''}`}>
            {byDay(items).map((g) => (
              <section key={g.label} className="nc__day">
                <h3 className="nc__day-title">{g.label}</h3>
                <ul>
                  {g.items.map((n) => (
                    <li key={n.id} className={`nc-item ${n.read ? '' : 'is-unread'} ${n.type === 'recognition' ? 'nc-item--recognition' : ''}`}>
                      <span className="notif-item__icon">
                        <Icon name={NOTIFICATION_ICONS[n.type] || 'bell'} size={16} />
                      </span>
                      {/* Clic en el aviso: su detalle (y, para Administración, quién lo leyó). */}
                      <button type="button" className="nc-item__body" onClick={() => showDetail(n)}>
                        <span className="nc-item__meta">
                          <span>{NOTIFICATION_TYPE_LABELS[n.type] || 'Aviso'}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={n.created_at}>{timeOf(n.created_at)}</time>
                          {!n.read && <span className="nc-item__new">Nueva</span>}
                        </span>
                        {n.title && !n.body.startsWith(n.title.replace(/ \(prueba\)$/, '')) && <strong className="nc-item__title">{n.title}</strong>}
                        <span className="nc-item__text">{n.body}</span>
                      </button>
                      <div className="nc-item__actions">
                        {!n.read && (
                          <button type="button" className="row-action row-action--view" onClick={() => markRead(n)} title="Marcar como leída" aria-label="Marcar como leída">
                            <Icon name="check" size={16} />
                          </button>
                        )}
                        {n.link && (
                          <Button size="sm" variant="secondary" onClick={() => open(n)}>
                            {n.data?.link_label || 'Ver detalle'} <Icon name="arrowRight" size={14} />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="nc__pager">
            <span className="text-sm text-muted">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </span>
            <div className="nc__pager-buttons">
              <Button size="sm" variant="secondary" icon="chevronLeft" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || loading}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page >= pages || loading}>
                Siguiente <Icon name="chevronRight" size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <NotificationDetailDrawer
          notification={selected}
          canAudit={canAudit}
          onClose={() => setSelected(null)}
          onOpenLink={(n) => {
            setSelected(null);
            open(n);
          }}
        />
      )}
    </div>
  );
}

export default NotificationCenterPage;
