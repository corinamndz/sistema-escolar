import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Icon from '../ui/Icon';
import { findRouteMeta } from './navigation';
import { initials } from './initials';

/** Estado abierto/cerrado de un menú desplegable que se cierra con click afuera o Escape. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, ref, toggle: () => setOpen((o) => !o) };
}

function Topbar({ onOpenMobileSidebar }) {
  const { user, logout, can } = useAuth();
  const { settings } = useTenant();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userMenu = useDropdown();
  const notifications = useDropdown();

  const meta = findRouteMeta(pathname);
  const displayName = user?.fullName || user?.username;

  // Al navegar, cerrar los menús abiertos.
  useEffect(() => {
    userMenu.setOpen(false);
    notifications.setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button className="topbar__icon-btn mobile-only" onClick={onOpenMobileSidebar} aria-label="Abrir menú">
          <Icon name="menu" size={20} />
        </button>
        <div className="topbar__crumbs">
          {meta?.parent && <span className="topbar__crumb-parent">{meta.parent}</span>}
          <span className="topbar__title">{meta?.label || settings.name}</span>
        </div>
      </div>

      <div className="topbar__right">
        <div className="topbar__school" title={settings.name}>
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="" className="topbar__school-logo" />
          ) : (
            <span className="topbar__school-logo">
              <Icon name="building" size={14} />
            </span>
          )}
          <span>{settings.name}</span>
        </div>

        <div className="dropdown" ref={notifications.ref}>
          <button
            className="topbar__icon-btn"
            onClick={notifications.toggle}
            aria-label="Notificaciones"
            aria-expanded={notifications.open}
            aria-haspopup="true"
          >
            <Icon name="bell" size={19} />
          </button>
          {notifications.open && (
            <div className="dropdown__panel dropdown__panel--wide" role="menu">
              <div className="dropdown__header">
                <span className="dropdown__title">Notificaciones</span>
              </div>
              <div className="empty-state" style={{ border: 'none', background: 'none', padding: '24px 12px' }}>
                <div className="empty-state__icon">
                  <Icon name="checkCircle" size={22} />
                </div>
                <div className="empty-state__title">Estás al día</div>
                <div className="text-sm">No tienes notificaciones nuevas.</div>
              </div>
            </div>
          )}
        </div>

        <span className="topbar__divider" />

        <div className="dropdown" ref={userMenu.ref}>
          <button
            className="topbar__user-btn"
            onClick={userMenu.toggle}
            aria-expanded={userMenu.open}
            aria-haspopup="true"
            aria-label="Menú de usuario"
          >
            <div className="topbar__avatar">{initials(displayName)}</div>
            <div className="topbar__user-meta">
              <span className="topbar__user-name">{displayName}</span>
              <span className="topbar__user-sub">@{user?.username}</span>
            </div>
            <Icon name="chevronDown" size={16} className="topbar__chevron" />
          </button>

          {userMenu.open && (
            <div className="dropdown__panel" role="menu">
              <div className="dropdown__header">
                <div className="avatar">{initials(displayName)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="topbar__user-name">{displayName}</div>
                  <div className="topbar__user-sub">{settings.name}</div>
                </div>
              </div>
              <Link to="/payments/mine" className="dropdown__item" role="menuitem">
                <Icon name="receipt" size={17} /> Mis pagos
              </Link>
              {can('tenant_settings', 'read') && (
                <Link to="/tenant/settings" className="dropdown__item" role="menuitem">
                  <Icon name="settings" size={17} /> Configuración del colegio
                </Link>
              )}
              <div className="dropdown__sep" />
              <button type="button" className="dropdown__item dropdown__item--danger" onClick={handleLogout} role="menuitem">
                <Icon name="logout" size={17} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Topbar;
