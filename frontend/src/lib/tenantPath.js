import { isValidSlug, normalizeSlug, resolveTenantSlug } from './tenantSlug';

/**
 * Colegio en la ruta: http://localhost:5173/<slug>/...
 * ----------------------------------------------------
 * El primer segmento de la URL identifica al colegio. La app completa se monta
 * debajo de él con el `basename` de React Router, así que las rutas internas
 * (`/students`, `navigate('/payments')`, `<Link to="/">`) no cambian: el router
 * les antepone `/<slug>` solo.
 *
 * El colegio se fija UNA vez al cargar la página: pasar a otro colegio es
 * siempre una navegación completa (y con ella cambia también la sesión, que
 * se guarda por colegio: ver api/tokenStore.js).
 */

/**
 * Primeros segmentos que son rutas de la app, no colegios. Un colegio no puede
 * usar estos identificadores (el panel superadmin también los reserva).
 */
export const APP_ROUTES = new Set([
  'login', 'tenant', 'roles', 'staff', 'students', 'guardians', 'academics', 'schedules',
  'discipline', 'clubs', 'events', 'evaluation-plans', 'programmatic-content', 'grading',
  'payments', 'portal', 'api', 'storage', 'assets', 'src', 'node_modules', '@vite', '@react-refresh',
  // Faltaban: recargar estas páginas (F5) o abrir sus enlaces las tomaba como colegio y mandaba al login.
  'appointments', 'notifications', 'configuracion-inicial', 'secciones-academicas', 'audit',
]);
// ⚠ Toda ruta NUEVA de primer nivel de App.jsx va aquí (y en admin-modo-educa: utils/slug.js y lib/slug.js).

function firstSegment(pathname) {
  try {
    return decodeURIComponent(pathname.split('/')[1] || '');
  } catch {
    return '';
  }
}

/** Slug del colegio en la ruta, o null si la URL no lo trae. */
export function slugFromPath(pathname = window.location.pathname) {
  const segment = normalizeSlug(firstSegment(pathname));
  return segment && isValidSlug(segment) && !APP_ROUTES.has(segment) ? segment : null;
}

/** Colegio de esta carga de página (null = URL sin colegio). */
export const PATH_TENANT = slugFromPath();

/** `basename` para <BrowserRouter>: '/demo' o undefined. */
export const routerBasename = PATH_TENANT ? `/${PATH_TENANT}` : undefined;

/** '/demo/login' a partir de ('demo', '/login'). */
export function tenantUrl(slug, path = '/') {
  return `/${encodeURIComponent(normalizeSlug(slug))}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Ruta absoluta dentro del colegio actual (para <a href>, fuera del router). */
export const appUrl = (path = '/') => (PATH_TENANT ? tenantUrl(PATH_TENANT, path) : path);

/**
 * URLs sin colegio en la ruta (formato anterior o enlaces viejos):
 *   /login?colegio=demo   → /demo/login
 *   /students  (último colegio usado: demo) → /demo/students
 * Con subdominio (demo.miapp.com) no se redirige: el subdominio ya es el colegio.
 * Devuelve true si redirige (la app no debe montarse).
 */
export function redirectLegacyUrl(loc = window.location) {
  if (PATH_TENANT) return false;
  const { slug, source } = resolveTenantSlug(loc);
  if (!slug || source === 'subdomain') return false;

  const params = new URLSearchParams(loc.search);
  params.delete('colegio');
  params.delete('tenant');
  const query = params.toString();
  // Por enlace (?colegio=) se llega al login de ese colegio; por recuerdo, a la misma página.
  const path = loc.pathname === '/' && source === 'url' ? '/login' : loc.pathname;
  loc.replace(`${tenantUrl(slug, path)}${query ? `?${query}` : ''}${loc.hash}`);
  return true;
}
