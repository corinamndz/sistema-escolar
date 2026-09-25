import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

const COLLAPSED_KEY = 'ui.sidebarCollapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed); // desktop: angosto/ancho (se recuerda entre sesiones)
  const [mobileOpen, setMobileOpen] = useState(false); // mobile: drawer abierto/cerrado
  const { pathname } = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // almacenamiento no disponible (modo privado): solo no se recuerda la preferencia
    }
  }, [collapsed]);

  // Cerrar el drawer al cambiar de ruta y volver arriba en la página nueva.
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  // Mientras el drawer móvil está abierto: bloquear el scroll de fondo y cerrar con Escape.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [mobileOpen]);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />

      <div className={`app-main ${collapsed ? 'app-main--collapsed' : ''}`}>
        <Topbar onOpenMobileSidebar={() => setMobileOpen(true)} />
        <main className="app-content" key={pathname}>
          <Outlet />
        </main>
      </div>

      {mobileOpen && <div className="app-overlay" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
    </div>
  );
}

export default AppLayout;
