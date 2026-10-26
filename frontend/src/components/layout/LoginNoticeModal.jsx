import { useEffect, useState } from 'react';
import notificationsApi from '../../api/endpoints/notifications.api';
import { getRefreshToken } from '../../api/tokenStore';
import { useAuth } from '../../context/AuthContext';
import { openNotifications } from '../../lib/notificationEvents';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Icon from '../ui/Icon';
import { NOTIFICATION_ICONS } from './NotificationBell';
import { timeAgo } from '../../features/payments/components/BcvRateCard';

const PREFIX = 'modo.loginNotice.';
const shownInMemory = new Set(); // respaldo si el navegador no deja guardar

/** Categoría visible de cada tipo de aviso (línea secundaria de la tarjeta). */
const TYPE_LABELS = {
  bcv_rate: 'Tasa BCV',
  payment_confirmed: 'Pagos',
  school_event: 'Evento',
  sanction: 'Convivencia',
  club_enrollment: 'Clubes',
  parent_meeting: 'Citas con padres',
  evaluation_plan: 'Plan de evaluación',
  review_request: 'Revisión académica',
  review_result: 'Revisión académica',
};
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Identificador de ESTE inicio de sesión: usuario + fecha de emisión del token
 * de refresco (no cambia al renovar el de acceso; sí al volver a iniciar sesión).
 */
function loginStamp(user) {
  try {
    const payload = JSON.parse(atob(String(getRefreshToken() || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return `${payload.sub || user?.id}.${payload.iat}`;
  } catch {
    return user?.id ? `${user.id}.sin-token` : null;
  }
}

function alreadyShown(stamp) {
  if (shownInMemory.has(stamp)) return true;
  try {
    return localStorage.getItem(PREFIX + stamp) === '1';
  } catch {
    return false;
  }
}

function markShown(stamp) {
  shownInMemory.add(stamp);
  try {
    // Una marca por usuario: se borran las de inicios de sesión anteriores.
    const user = stamp.split('.')[0];
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`${PREFIX}${user}.`) && k !== PREFIX + stamp)
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(PREFIX + stamp, '1');
  } catch {
    // sin almacenamiento: queda la marca en memoria (no se repite en esta pestaña)
  }
}

/**
 * Aviso al iniciar sesión: si el usuario (de cualquier rol) tiene notificaciones
 * sin leer, se le muestra una vez por inicio de sesión —no al navegar entre
 * páginas, ni al recargar, ni en otra pestaña— con un acceso directo a la campana.
 * Espera a que no haya un cambio de contraseña obligatorio pendiente.
 */
function LoginNoticeModal() {
  const { user, mustChangePassword } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!user || mustChangePassword) return undefined;
    const stamp = loginStamp(user);
    if (!stamp || alreadyShown(stamp)) return undefined;
    let cancelled = false;
    notificationsApi
      .unreadCount()
      .then((s) => {
        if (cancelled) return;
        markShown(stamp); // consultado: no se vuelve a preguntar en este inicio de sesión
        if (s.unread_count > 0) setSummary(s);
      })
      .catch(() => {}); // si falla, la campana igual muestra el contador
    return () => {
      cancelled = true;
    };
  }, [user, mustChangePassword]);

  if (!summary) return null;
  const n = summary.unread_count;
  const close = () => setSummary(null);
  const view = () => {
    close();
    openNotifications();
  };
  const more = n - summary.latest.length;
  const firstName = user?.fullName?.split(' ')[0];

  return (
    <Modal title="Notificaciones pendientes" onClose={close} size="sm" hideHeader className="modal--notice" overlayClassName="modal-overlay--notice">
      <div className="login-notice" role="alertdialog" aria-labelledby="login-notice-title" aria-describedby="login-notice-text">
        <button type="button" className="login-notice__close" onClick={close} aria-label="Cerrar">
          <Icon name="x" size={18} />
        </button>

        <header className="login-notice__header">
          {/* Círculo suave con la campana; el contador va DENTRO, en su esquina. */}
          <div className="login-notice__bell" aria-hidden="true">
            <Icon name="bell" size={30} strokeWidth={1.8} />
            <span className="login-notice__count">{n > 99 ? '99+' : n}</span>
          </div>
          <h2 id="login-notice-title" className="login-notice__heading">
            Tienes {n} {n === 1 ? 'notificación' : 'notificaciones'} sin leer
          </h2>
          <p id="login-notice-text" className="login-notice__lead">
            {firstName ? `Hola, ${firstName}. ` : ''}Revisa las novedades en la campana de la parte superior.
          </p>
        </header>

        <section className="login-notice__body" aria-label="Más recientes">
          <h3 className="login-notice__section">Más recientes</h3>
          <div className="login-notice__cards">
            {summary.latest.map((item) => (
              <article key={item.id} className={`login-notice__card login-notice__card--${item.type}`}>
                <span className="login-notice__tile" aria-hidden="true">
                  <Icon name={NOTIFICATION_ICONS[item.type] || 'bell'} size={18} />
                </span>
                <div className="login-notice__text">
                  <strong className="login-notice__title">{item.title}</strong>
                  {/* Separador como texto (con espacios): nunca se juntan las palabras. */}
                  <span className="login-notice__meta">
                    {TYPE_LABELS[item.type] || 'Aviso'}
                    <span className="login-notice__dot" aria-hidden="true">{' • '}</span>
                    {capitalize(timeAgo(item.created_at))}
                  </span>
                </div>
              </article>
            ))}
          </div>
          {more > 0 && (
            <p className="login-notice__more">
              + {more} {more === 1 ? 'notificación más' : 'notificaciones más'} en la campana
            </p>
          )}
        </section>

        <footer className="login-notice__footer">
          <Button variant="secondary" onClick={close}>
            Entendido
          </Button>
          <Button icon="bell" onClick={view} autoFocus>
            Ver notificaciones
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default LoginNoticeModal;
