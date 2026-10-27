import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import notificationsApi from '../../api/endpoints/notifications.api';
import Icon from '../ui/Icon';
import Drawer from '../ui/Drawer';
import { formatRate } from '../../features/payments/currency';
import { formatDate } from '../../features/payments/paymentStatus';
import { SOURCE_LABELS, timeAgo } from '../../features/payments/components/BcvRateCard';
import { NOTIFICATIONS_OPEN, NOTIFICATIONS_REFRESH, notifyRatesChanged } from '../../lib/notificationEvents';
import { isEffective } from '../../features/payments/useRateAutoRefresh';
import RateTuitionImpact from '../../features/payments/components/RateTuitionImpact';
import { RecognitionCelebration } from '../../features/recognitions/components/RecognitionCard';
import { CertificateModal } from '../../features/recognitions/components/RecognitionCertificate';
import portalApi from '../../api/endpoints/portal.api';

const POLL_MS = 60 * 1000; // la tasa cambia pocas veces al día: un minuto de demora es suficiente
// Ícono por tipo de aviso (también lo usa el aviso al iniciar sesión).
export const NOTIFICATION_ICONS = {
  bcv_rate: 'trendingUp',
  payment_confirmed: 'receipt',
  school_event: 'calendar',
  sanction: 'shield',
  club_enrollment: 'star',
  parent_meeting: 'users',
  evaluation_plan: 'clipboard',
  evaluation_reminder: 'clock',
  recognition: 'award',
  payment_overdue: 'alertCircle',
  review_request: 'clipboard',
  review_result: 'checkCircle',
};
/** Categoría visible de cada tipo de aviso (aviso al iniciar sesión, Centro de notificaciones). */
export const NOTIFICATION_TYPE_LABELS = {
  bcv_rate: 'Tasa BCV',
  payment_confirmed: 'Pagos',
  school_event: 'Evento',
  sanction: 'Convivencia',
  club_enrollment: 'Clubes',
  parent_meeting: 'Citas con padres',
  evaluation_plan: 'Plan de evaluación',
  evaluation_reminder: 'Recordatorio de evaluación',
  recognition: 'Reconocimiento',
  payment_overdue: 'Pagos vencidos',
  review_request: 'Revisión académica',
  review_result: 'Revisión académica',
};

/**
 * Campana de notificaciones del Topbar. Consulta las del usuario al cargar,
 * cada minuto y al volver a la pestaña; muestra el contador de no leídas.
 * Al tocar una notificación se marca como leída y se abre su detalle.
 * `dropdown`: estado del menú (abierto/cerrado, click afuera) del Topbar.
 */
function NotificationBell({ dropdown }) {
  const [data, setData] = useState({ items: [], unread_count: 0 });
  const [selected, setSelected] = useState(null);
  const alive = useRef(true);

  // Último aviso de tasa BCV visto: si llega uno nuevo, las pantallas con tasas se recargan solas.
  const lastRateNotice = useRef(undefined);
  const load = useCallback(async () => {
    try {
      const next = await notificationsApi.list();
      if (!alive.current) return;
      setData(next);
      const latest = next.items.find((n) => n.type === 'bcv_rate' && !n.data?.simulated)?.id ?? null;
      if (lastRateNotice.current !== undefined && latest && latest !== lastRateNotice.current) notifyRatesChanged();
      lastRateNotice.current = latest;
    } catch {
      // en segundo plano: si falla, se reintenta en la siguiente consulta
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    window.addEventListener(NOTIFICATIONS_REFRESH, load);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
      window.removeEventListener(NOTIFICATIONS_REFRESH, load);
    };
  }, [load]);

  // Otro componente pide abrir el desplegable (aviso al iniciar sesión → "Ver notificaciones").
  const { setOpen } = dropdown;
  useEffect(() => {
    const openMenu = () => setTimeout(() => setOpen(true), 0); // después del clic que lo pidió
    window.addEventListener(NOTIFICATIONS_OPEN, openMenu);
    return () => window.removeEventListener(NOTIFICATIONS_OPEN, openMenu);
  }, [setOpen]);

  // Al abrir el menú, datos frescos.
  useEffect(() => {
    if (dropdown.open) load();
  }, [dropdown.open, load]);

  const markLocal = (pred) =>
    setData((d) => {
      const items = d.items.map((n) => (pred(n) ? { ...n, read: true } : n));
      return { items, unread_count: items.filter((n) => !n.read).length };
    });

  const open = (n) => {
    setSelected(n);
    dropdown.setOpen(false);
    if (!n.read) {
      markLocal((x) => x.id === n.id);
      notificationsApi.markRead(n.id).catch(() => load());
    }
  };

  const readAll = () => {
    markLocal(() => true);
    notificationsApi.markAllRead().catch(() => load());
  };

  const unread = data.unread_count;

  return (
    <>
      <div className="dropdown" ref={dropdown.ref}>
        <button
          className="topbar__icon-btn notif-bell"
          onClick={dropdown.toggle}
          aria-label={unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
          aria-expanded={dropdown.open}
          aria-haspopup="true"
        >
          <Icon name="bell" size={19} />
          {unread > 0 && <span className="notif-bell__badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {dropdown.open && (
          <div className="dropdown__panel dropdown__panel--wide notif-panel" role="menu">
            <div className="dropdown__header notif-panel__header">
              <span className="dropdown__title">Notificaciones</span>
              {unread > 0 && (
                <button type="button" className="link-button notif-panel__readall" onClick={readAll}>
                  Marcar todas como leídas
                </button>
              )}
            </div>
            {data.items.length === 0 ? (
              <div className="empty-state" style={{ border: 'none', background: 'none', padding: '24px 12px' }}>
                <div className="empty-state__icon">
                  <Icon name="checkCircle" size={22} />
                </div>
                <div className="empty-state__title">Estás al día</div>
                <div className="text-sm">No tienes notificaciones nuevas.</div>
              </div>
            ) : (
              <ul className="notif-list">
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`notif-item ${n.read ? '' : 'is-unread'} ${n.type === 'recognition' ? 'notif-item--recognition' : ''}`} onClick={() => open(n)} role="menuitem">
                      <span className="notif-item__icon">
                        <Icon name={NOTIFICATION_ICONS[n.type] || 'bell'} size={16} />
                      </span>
                      <span className="notif-item__body">
                        {/* El título (p. ej. el nombre del evento), salvo que el texto ya empiece con él. */}
                        {n.title && !n.body.startsWith(n.title.replace(/ \(prueba\)$/, '')) && <span className="notif-item__title">{n.title}</span>}
                        <span className="notif-item__text">{n.body}</span>
                        <span className="notif-item__time">{timeAgo(n.created_at)}</span>
                      </span>
                      {!n.read && <span className="notif-item__dot" aria-label="Sin leer" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="notif-panel__footer">
              <Link to="/notifications" className="notif-panel__center" onClick={() => dropdown.setOpen(false)}>
                Abrir centro de notificaciones <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </div>
        )}
      </div>
      {selected && <NotificationDetail notification={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/** Detalle de una notificación. La de tasa BCV muestra la tasa, su fecha valor y la variación. */
function NotificationDetail({ notification: n, onClose }) {
  // Reconocimiento a un alumno: tarjeta de celebración.
  // Reconocimiento a un alumno: tarjeta de celebración y certificado.
  if (n.type === 'recognition' && n.data?.title) return <RecognitionNotice notification={n} onClose={onClose} />;
  if (n.type !== 'bcv_rate') {
    return (
      <Drawer title={n.title} onClose={onClose}>
        <div className="notif-generic">
          <span className="notif-item__icon">
            <Icon name={NOTIFICATION_ICONS[n.type] || 'bell'} size={18} />
          </span>
          <p>{n.body}</p>
        </div>
        <p className="text-sm text-muted">{new Date(n.created_at).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <div className="form-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cerrar
          </button>
          {n.link && (
            <Link to={n.link} className="btn btn--primary" onClick={onClose}>
              {n.data?.link_label || 'Ver detalle'}
            </Link>
          )}
        </div>
      </Drawer>
    );
  }
  const { rate, rate_date: rateDate, previous_rate: prev, source, simulated, effective_at: effectiveAt, bcv_value_date: bcvValueDate } = n.data || {};
  // Se calcula al abrir (no al crear el aviso): la tasa de mañana ya está vigente si el aviso se lee después.
  const effectiveNow = isEffective(rateDate);
  const change = prev ? ((rate - prev) / prev) * 100 : null;
  return (
    <Drawer title={simulated ? 'Tasa BCV actualizada (prueba)' : 'Tasa BCV actualizada'} onClose={onClose}>
      <div className="notif-rate">
        {simulated && (
          <div className="notif-rate__test">
            <Icon name="info" size={15} /> Aviso de prueba generado desde «Simular actualización BCV»: esta tasa no se registró ni cambia ningún monto.
          </div>
        )}
        <div className="notif-rate__value">
          {formatRate(rate, 'VES')} <small>por $1</small>
        </div>
        <dl className="notif-rate__facts">
          <div>
            <dt>{effectiveAt ? 'Vigente desde' : 'Fecha valor'}</dt>
            <dd>
              {formatDate(rateDate)}
              {effectiveAt ? ` a las ${effectiveAt}` : ` · ${effectiveNow ? 'vigente' : 'regirá desde ese día'}`}
            </dd>
          </div>
          {bcvValueDate && bcvValueDate !== rateDate && (
            <div>
              <dt>Fecha valor publicada por el BCV</dt>
              <dd>{formatDate(bcvValueDate)} (el colegio la aplica desde la consulta)</dd>
            </div>
          )}
          {change !== null && (
            <div>
              <dt>Variación</dt>
              <dd className={change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}>
                {change > 0 ? '+' : ''}
                {change.toLocaleString('es-VE', { maximumFractionDigits: 2 })} % frente a {formatRate(prev, 'VES')}
              </dd>
            </div>
          )}
          <div>
            <dt>Origen</dt>
            <dd>{SOURCE_LABELS[source] || 'BCV'}</dd>
          </div>
          <div>
            <dt>Actualizada</dt>
            <dd>{new Date(n.created_at).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          </div>
        </dl>
        <RateTuitionImpact data={n.data} />
        {!n.data?.tuition && <p className="text-sm text-muted">Los montos en bolívares de las cuotas pendientes se calculan con la tasa vigente del día.</p>}
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          Cerrar
        </button>
        {n.link && (
          <Link to={n.link} className="btn btn--primary" onClick={onClose}>
            <Icon name="receipt" size={16} /> {n.link === '/payments/mine' ? 'Ver mis pagos' : 'Ver tasas y pagos'}
          </Link>
        )}
      </div>
    </Drawer>
  );
}

/** Aviso de reconocimiento: tarjeta de celebración, con el certificado (ver, imprimir, PDF). */
function RecognitionNotice({ notification: n, onClose }) {
  const [certificate, setCertificate] = useState(false);
  const recognition = { ...n.data, id: n.data.recognition_id };
  return (
    <>
      <Drawer title="¡Un logro para celebrar!" icon="award" onClose={onClose}>
        <RecognitionCelebration recognition={recognition} />
        <div className="form-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setCertificate(true)}>
            <Icon name="file" size={16} /> Ver certificado
          </button>
          {n.link && (
            <Link to={n.link} className="btn btn--primary" onClick={onClose}>
              <Icon name="award" size={16} /> {n.data?.link_label || 'Ver sus reconocimientos'}
            </Link>
          )}
        </div>
      </Drawer>
      {certificate && (
        <CertificateModal
          recognition={recognition}
          loadPdf={() => portalApi.getRecognitionCertificateBlob(n.data.student_id, n.data.recognition_id)}
          onClose={() => setCertificate(false)}
        />
      )}
    </>
  );
}

export default NotificationBell;
