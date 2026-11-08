import { isPortalViewOn } from '../../lib/portalViews';

/**
 * Menú principal agrupado por secciones. `moduleCode` se valida contra los
 * permisos del usuario (`can(moduleCode, 'read')`); `public: true` lo muestra
 * a cualquier usuario autenticado; `guardianOnly` solo a representantes;
 * `teacherOnly` solo a usuarios con ficha docente;
 * `blockTeacher` lo oculta a los docentes restringidos a su carga (el backend
 * igual responde 403); `portalView` lo oculta si el colegio desactivó esa
 * sección del portal (Configuración → Vistas del representante);
 * `admissionsOnly` solo al Administrador y al rol Admisiones (canManageAdmissions). El Topbar
 * usa esta misma lista para el título de la página actual.
 */
const NAV_SECTIONS = [
  {
    label: 'General',
    // Solo para quien tiene panel de inicio (ver hasDashboard); el resto entra directo a su módulo.
    items: [{ moduleCode: 'dashboard', label: 'Inicio', icon: 'home', path: '/', home: true }],
  },
  {
    label: 'Comunidad escolar',
    items: [
      { moduleCode: 'students', label: 'Alumnos', teacherLabel: 'Mis alumnos', icon: 'graduation', path: '/students' },
      { moduleCode: 'guardians', label: 'Representantes', icon: 'users', path: '/guardians' },
      // Coordinador: gestiona solo a los docentes de su etapa.
      { moduleCode: 'staff', label: 'Personal', coordinatorLabel: 'Docentes de mi etapa', icon: 'briefcase', path: '/staff' },
      // Sanciones disciplinarias: módulo de la administración. El docente consulta
      // las de sus alumnos en la ficha de cada uno; el representante, en el portal.
      { moduleCode: 'discipline', label: 'Convivencia', icon: 'shield', path: '/discipline', blockTeacher: true },
      // Reconocimientos: docentes (sus alumnos) y administración otorgan logros; la familia recibe un aviso festivo.
      { moduleCode: 'recognitions', label: 'Reconocimientos', icon: 'award', path: '/recognitions' },
      // Clubes y actividades extracurriculares (coro, banda, deportes…).
      { moduleCode: 'clubs', label: 'Clubes', icon: 'star', path: '/clubs' },
      // Cartelera de eventos: la administración la gestiona; las familias la consultan en el portal.
      { moduleCode: 'events', label: 'Eventos y cartelera', icon: 'calendar', path: '/events' },
      // Citas con padres: la administración agenda; el docente consulta las de sus alumnos.
      { moduleCode: 'appointments', label: 'Citas con padres', teacherLabel: 'Citas de mis alumnos', icon: 'clock', path: '/appointments' },
      { moduleCode: 'portal_events', label: 'Cartelera', icon: 'calendar', path: '/portal/events', guardianOnly: true, portalView: 'events' },
      // La familia completa la planilla en «Inscripción»; el Administrador la diseña y aprueba (sección Administración).
      { moduleCode: 'portal_enrollment', label: 'Inscripción', icon: 'clipboard', path: '/portal/enrollment', guardianOnly: true },
    ],
  },
  {
    label: 'Académico',
    items: [
      // Estructura académica: primero la base (asistente de pasos), luego la operación diaria.
      { moduleCode: 'academics', label: 'Configuración inicial', icon: 'building', path: '/configuracion-inicial', blockTeacher: true },
      { moduleCode: 'academics', label: 'Secciones y docentes', icon: 'school', path: '/secciones-academicas', blockTeacher: true },
      // Materias: en qué grados y secciones se dicta cada una y qué docente la imparte.
      { moduleCode: 'academics', label: 'Materias', icon: 'book', path: '/academics/subjects', blockTeacher: true },
      // Contenido programático: unidades y temas de cada materia con sus evaluaciones (docentes: sus materias).
      // `reviewBadge`: insignia con lo que espera revisión del coordinador o el Director.
      { moduleCode: 'evaluation_plans', label: 'Contenido programático', icon: 'layers', path: '/programmatic-content', reviewBadge: 'content' },
      { moduleCode: 'evaluation_plans', label: 'Planes de evaluación', icon: 'clipboard', path: '/evaluation-plans', reviewBadge: 'plan' },
      // Resumen de calificaciones del colegio: acumulado por lapso de cada alumno (administración).
      // El Coordinador también lo ve (solo su nivel) para el ajuste directivo de definitivas.
      { moduleCode: 'grading', label: 'Resumen de calificaciones', icon: 'trendingUp', path: '/grading/summary', blockTeacher: true, coordinatorToo: true },
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
      { moduleCode: 'my_payments', label: 'Mis pagos', icon: 'receipt', path: '/payments/mine', guardianOnly: true, blockTeacher: true, portalView: 'payments' },
    ],
  },
  {
    label: 'Administración',
    // Se lista en orden alfabético (Sidebar), sin importar el orden de este arreglo.
    sortAlphabetically: true,
    items: [
      { moduleCode: 'roles', label: 'Roles y permisos', icon: 'shield', path: '/roles' },
      { moduleCode: 'tenant_settings', label: 'Configuración', icon: 'settings', path: '/tenant/settings' },
      // Planillas de inscripción: exclusivas del Administrador y del rol Admisiones. «Recibidas» es la
      // bandeja de revisión (aprobar = alta del alumno, sus representantes y la matrícula).
      { moduleCode: 'enrollment_forms', label: 'Planillas recibidas', icon: 'inbox', path: '/enrollment-submissions', admissionsOnly: true },
      { moduleCode: 'enrollment_forms', label: 'Diseño de planillas', icon: 'clipboard', path: '/enrollment-forms', admissionsOnly: true },
      // Historial de correos, avisos de la campana, credenciales y comprobantes, con reenvío.
      // Comunicados: avisos con formato a todo el colegio, niveles, grados, secciones o personas.
      { moduleCode: 'announcements', label: 'Comunicados', icon: 'megaphone', path: '/notifications/announcements', blockTeacher: true },
      { moduleCode: 'tenant_settings', label: 'Log de notificaciones', icon: 'inbox', path: '/notifications/log', blockTeacher: true },
      // Bitácora de actividad: exclusiva del Administrador (rol de sistema), no depende de permisos de módulo.
      { moduleCode: 'audit', label: 'Auditoría', icon: 'eye', path: '/audit', adminOnly: true },
      // Soporte técnico: el Administrador reporta fallas a la plataforma (panel central del superadmin).
      { moduleCode: 'support', label: 'Soporte técnico', icon: 'helpCircle', path: '/support', adminOnly: true },
    ],
  },
];

/** Rutas de detalle que no están en el menú, para el título del Topbar. */
const EXTRA_TITLES = [
  { prefix: '/grading/plans/', label: 'Calificaciones', parent: 'Académico' },
  { prefix: '/portal/students/', label: 'Mi alumno', parent: 'Portal' },
  { prefix: '/enrollment-forms/', label: 'Diseño de planilla', parent: 'Administración' },
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

/** Nombre del ítem para el usuario (el docente ve "Mis alumnos"; el coordinador, "Docentes de mi etapa"). */
function navItemLabel(item, user) {
  return (user?.isRestrictedTeacher && item.teacherLabel) || (user?.coordinator && item.coordinatorLabel) || item.label;
}

/**
 * ¿Tiene panel de inicio? Representantes y docentes ven su propio panel; el
 * resto, solo con permiso "dashboard". Un rol acotado (ej. Finanzas) no lo
 * tiene: su inicio es su primer módulo.
 */
function hasDashboard({ can, user }) {
  return Boolean(user?.guardianId || user?.isRestrictedTeacher) || can('dashboard', 'read');
}

/** ¿Se muestra este ítem del menú al usuario? */
function isNavItemVisible(item, { can, user, portalViews }) {
  if (item.home) return hasDashboard({ can, user });
  if (!isPortalViewOn(portalViews, item.portalView)) return false;
  if (item.adminOnly) return Boolean(user?.isAdmin);
  if (item.admissionsOnly) return canManageAdmissions(user);
  if (item.blockTeacher && user?.isRestrictedTeacher) return false;
  // `coordinatorToo`: también para el Coordinador (el backend limita a su nivel).
  if (item.coordinatorToo && user?.coordinator) return true;
  if (item.guardianOnly) return Boolean(user?.guardianId);
  if (item.teacherOnly) return Boolean(user?.teachingStaffId);
  return Boolean(item.public) || can(item.moduleCode, 'read');
}

/** Planillas de inscripción (diseño, bandeja y aprobación): Administrador o rol Admisiones. */
function canManageAdmissions(user) {
  return Boolean(user?.isAdmin || user?.isAdmissions);
}

/** Página de inicio del usuario: el panel, o la primera página del menú que puede ver (null si ninguna). */
function homePath(ctx) {
  if (hasDashboard(ctx)) return '/';
  // Admisiones: su trabajo empieza en la bandeja de planillas.
  if (ctx.user?.isAdmissions) return '/enrollment-submissions';
  const first = NAV_SECTIONS.flatMap((s) => s.items).find((item) => !item.home && isNavItemVisible(item, ctx));
  return first?.path || null;
}

export { NAV_SECTIONS, findRouteMeta, isNavItemVisible, navItemLabel, hasDashboard, homePath, canManageAdmissions };
