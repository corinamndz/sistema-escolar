import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import Icon from '../ui/Icon';
import SchoolLogo from '../ui/SchoolLogo';
import { NAV_SECTIONS, isNavItemVisible, navItemLabel } from './navigation';
import { initials } from './initials';

const SECTIONS_KEY = 'ui.sidebar.closedSections';

/** Grupos del menú que el usuario dejó contraídos (por defecto, todos abiertos). */
function readClosedSections() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SECTIONS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

// Rutas que solo se marcan activas si coinciden exactamente (igual que `end` en NavLink).
const EXACT_PATHS = new Set(['/', '/payments', '/schedules']);
const isActivePath = (path, pathname) => (EXACT_PATHS.has(path) ? pathname === path : pathname === path || pathname.startsWith(`${path}/`));

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

  // Grupos contraídos (por nombre), recordados en este navegador.
  const location = useLocation();
  const [closedSections, setClosedSections] = useState(readClosedSections);
  const toggleSection = (label) =>
    setClosedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // sin almacenamiento (modo privado): solo dura mientras la página esté abierta
      }
      return next;
    });

  return (
    <aside
      className={['sidebar', compact ? 'sidebar--collapsed' : '', mobileOpen ? 'sidebar--mobile-open' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label="Menú principal"
    >
      <div className="sidebar__brand">
        {/* Sin logo propio (o si no carga): el de MoDo Educa. */}
        <SchoolLogo src={settings.logoUrl} name={settings.name} className="sidebar__logo" />

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
        {sections.map((section) => {
          // Con el menú en modo íconos no se colapsan grupos: todos los íconos a la vista.
          const open = compact || !closedSections.has(section.label);
          const bodyId = `sidebar-section-${section.label.replace(/\s+/g, '-').toLowerCase()}`;
          const hasActive = section.items.some((item) => isActivePath(item.path, location.pathname));
          return (
            <div key={section.label} className={`sidebar__section ${open ? 'is-open' : 'is-closed'}`}>
              {compact ? (
                <div className="sidebar__section-label">{section.label}</div>
              ) : (
                <button
                  type="button"
                  className="sidebar__section-label sidebar__section-toggle"
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={open}
                  aria-controls={bodyId}
                >
                  <span>{section.label}</span>
                  {/* Grupo contraído que contiene la página actual: punto indicador. */}
                  {!open && hasActive && <span className="sidebar__section-dot" aria-label="Contiene la página actual" />}
                  <Icon name="chevronDown" size={14} className="sidebar__section-chevron" />
                </button>
              )}
              {/* grid-template-rows 0fr ↔ 1fr: altura animada sin medir el contenido. */}
              <div id={bodyId} className="sidebar__section-body" aria-hidden={!open} {...(open ? {} : { inert: '' })}>
                <div className="sidebar__section-items">
                  {section.items.map((item) => (
                    <NavLink
                      // La ruta es única; el módulo no (Pagos y Monedas y tasas comparten "payments").
                      key={item.path}
                      to={item.path}
                      end={EXACT_PATHS.has(item.path)}
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
              </div>
            </div>
          );
        })}
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
