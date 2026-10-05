/**
 * Menú principal agrupado por secciones. `moduleCode` se valida contra los
 * permisos del usuario (`can(moduleCode, 'read')`); `public: true` lo muestra
 * a cualquier usuario autenticado. El Topbar usa esta misma lista para el
 * título de la página actual.
 */
const NAV_SECTIONS = [
  {
    label: 'General',
    items: [{ moduleCode: 'dashboard', label: 'Inicio', icon: 'home', path: '/', public: true }],
  },
  {
    label: 'Comunidad escolar',
    items: [
      { moduleCode: 'students', label: 'Alumnos', icon: 'graduation', path: '/students' },
      { moduleCode: 'guardians', label: 'Representantes', icon: 'users', path: '/guardians' },
      { moduleCode: 'staff', label: 'Personal', icon: 'briefcase', path: '/staff' },
    ],
  },
  {
    label: 'Académico',
    items: [
      { moduleCode: 'academics', label: 'Grados y secciones', icon: 'school', path: '/academics' },
      { moduleCode: 'evaluation_plans', label: 'Planes de evaluación', icon: 'clipboard', path: '/evaluation-plans' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { moduleCode: 'payments', label: 'Pagos', icon: 'card', path: '/payments' },
      { moduleCode: 'payments', label: 'Monedas y tasas', icon: 'trendingUp', path: '/payments/currencies' },
      // Vista de padres: visible para cualquier usuario autenticado, sin depender de permisos administrativos
      { moduleCode: 'my_payments', label: 'Mis pagos', icon: 'receipt', path: '/payments/mine', public: true },
    ],
  },
  {
    label: 'Administración',
    items: [
      { moduleCode: 'roles', label: 'Roles y permisos', icon: 'shield', path: '/roles' },
      { moduleCode: 'tenant_settings', label: 'Configuración', icon: 'settings', path: '/tenant/settings' },
    ],
  },
];

/** Rutas de detalle que no están en el menú, para el título del Topbar. */
const EXTRA_TITLES = [
  { prefix: '/grading/plans/', label: 'Calificaciones', parent: 'Académico' },
  { prefix: '/portal/students/', label: 'Mi alumno', parent: 'Portal' },
  { prefix: '/academics/sections/', label: 'Detalle de sección', parent: 'Académico' },
];

/** Devuelve `{ label, parent }` para la ruta actual (coincidencia más específica). */
function findRouteMeta(pathname) {
  const extra = EXTRA_TITLES.find((e) => pathname.startsWith(e.prefix));
  if (extra) return extra;

  let best = null;
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const matches = item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`);
      if (matches && (!best || item.path.length > best.path.length)) {
        best = { ...item, parent: section.label };
      }
    }
  }
  return best;
}

export { NAV_SECTIONS, findRouteMeta };
