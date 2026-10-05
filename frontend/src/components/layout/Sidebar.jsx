import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Icon from '../ui/Icon';
import { NAV_SECTIONS, isNavItemVisible, navItemLabel } from './navigation';
import { initials } from './initials';

function Sidebar({ collapsed, mobileOpen, onCloseMobile, onToggleCollapsed }) {
  const { can, user } = useAuth();
  const { settings } = useTenant();

  // En el drawer móvil siempre se muestran las etiquetas, aunque en desktop esté colapsado.
  const compact = collapsed && !mobileOpen;

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isNavItemVisible(item, { can, user })).map((item) => ({ ...item, label: navItemLabel(item, user) })),
  })).filter((section) => section.items.length > 0);

  const displayName = user?.fullName || user?.username;

  return (
    <aside
      className={['sidebar', compact ? 'sidebar--collapsed' : '', mobileOpen ? 'sidebar--mobile-open' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="Menú principal"
    >
      <div className="sidebar__brand">
        {settings.logoUrl ? (
          <img src={settings.logoUrl} alt={settings.name} className="sidebar__logo" />
        ) : (
          <div className="sidebar__logo">
            <Icon name="school" size={20} />
          </div>
        )}
        {!compact && (
          <div className="sidebar__brand-text">
            <span className="sidebar__school-name" title={settings.name}>
              {settings.name}
            </span>
            <span className="sidebar__school-sub">Panel de gestión</span>
          </div>
        )}
        <button type="button" className="sidebar__close" onClick={onCloseMobile} aria-label="Cerrar menú">
          <Icon name="x" size={18} />
        </button>
      </div>

      <nav className="sidebar__nav">
        {sections.map((section) => (
          <div key={section.label} className="sidebar__section">
            <div className="sidebar__section-label">{section.label}</div>
            {section.items.map((item) => (
              <NavLink
                // La ruta es única; el módulo no (Pagos y Monedas y tasas comparten "payments").
                key={item.path}
                to={item.path}
                end={item.path === '/' || item.path === '/payments'}
                className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
                onClick={onCloseMobile}
                data-tooltip={compact ? item.label : undefined}
                aria-label={compact ? item.label : undefined}
              >
                <span className="sidebar__icon">
                  <Icon name={item.icon} size={19} />
                </span>
                {!compact && <span className="sidebar__label">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        {user && (
          <div className="sidebar__user" title={compact ? displayName : undefined}>
            <div className="avatar avatar--sm">{initials(displayName)}</div>
            {!compact && (
              <div style={{ minWidth: 0 }}>
                <div className="sidebar__user-name">{displayName}</div>
                <div className="sidebar__user-sub">@{user.username}</div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={compact ? 'Expandir menú' : 'Colapsar menú'}
        >
          <Icon name={compact ? 'chevronRight' : 'chevronLeft'} size={16} />
          {!compact && 'Colapsar menú'}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
