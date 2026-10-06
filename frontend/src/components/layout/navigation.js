/**
 * Menú principal agrupado por secciones. `moduleCode` se valida contra los
 * permisos del usuario (`can(moduleCode, 'read')`); `public: true` lo muestra
 * a cualquier usuario autenticado; `guardianOnly` solo a representantes;
 * `teacherOnly` solo a usuarios con ficha docente;
 * `blockTeacher` lo oculta a los docentes restringidos a su carga (el backend
 * igual responde 403). El Topbar usa esta misma lista para el título de la
 * página actual.
 */
const NAV_SECTIONS = [
  {
    label: 'General',
    items: [{ moduleCode: 'dashboard', label: 'Inicio', icon: 'home', path: '/', public: true }],
  },
  {
    label: 'Comunidad escolar',
    items: [
      { moduleCode: 'students', label: 'Alumnos', teacherLabel: 'Mis alumnos', icon: 'graduation', path: '/students' },
      { moduleCode: 'guardians', label: 'Representantes', icon: 'users', path: '/guardians' },
      { moduleCode: 'staff', label: 'Personal', icon: 'briefcase', path: '/staff' },
    ],
  },
  {
    label: 'Académico',
    items: [
      { moduleCode: 'academics', label: 'Grados y secciones', icon: 'school', path: '/academics', blockTeacher: true },
      { moduleCode: 'evaluation_plans', label: 'Planes de evaluación', icon: 'clipboard', path: '/evaluation-plans' },
      { moduleCode: 'schedules', label: 'Horarios', icon: 'calendar', path: '/schedules', blockTeacher: true },
      // Docentes: su horario semanal (solo lectura).
      { moduleCode: 'my_schedule', label: 'Mi horario', icon: 'clock', path: '/schedules/mine', teacherOnly: true },
      { moduleCode: 'promotion', label: 'Cierre y promoción', icon: 'graduation', path: '/academics/promotion', blockTeacher: true },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { moduleCode: 'payments', label: 'Pagos', icon: 'card', path: '/payments', blockTeacher: true },
      { moduleCode: 'payments', label: 'Monedas y tasas', icon: 'trendingUp', path: '/payments/currencies', blockTeacher: true },
      // Vista de padres: solo para cuentas de representante (no depende de permisos administrativos).
      { moduleCode: 'my_payments', label: 'Mis pagos', icon: 'receipt', path: '/payments/mine', guardianOnly: true, blockTeacher: true },
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

/** Nombre del ítem para el usuario (el docente ve "Mis alumnos"). */
function navItemLabel(item, user) {
  return (user?.isRestrictedTeacher && item.teacherLabel) || item.label;
}

/** ¿Se muestra este ítem del menú al usuario? */
function isNavItemVisible(item, { can, user }) {
  if (item.blockTeacher && user?.isRestrictedTeacher) return false;
  if (item.guardianOnly) return Boolean(user?.guardianId);
  if (item.teacherOnly) return Boolean(user?.teachingStaffId);
  return Boolean(item.public) || can(item.moduleCode, 'read');
}

export { NAV_SECTIONS, findRouteMeta, isNavItemVisible, navItemLabel };
