/**
 * Cómo se identifica el colegio ANTES de iniciar sesión, en orden de prioridad:
 *   1. Enlace directo:  https://app.com/login?colegio=demo   (o ?tenant=demo)
 *   2. Subdominio:      https://demo.miapp.com  si VITE_TENANT_BASE_DOMAIN=miapp.com
 *                       (en desarrollo también http://demo.localhost:5173)
 *   3. El último colegio con el que se inició sesión en este navegador.
 * Si nada aplica, el login se muestra genérico y se adapta al escribir el colegio.
 */

const STORAGE_KEY = 'ui.lastTenantSlug';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export const normalizeSlug = (value) => String(value || '').trim().toLowerCase();
export const isValidSlug = (value) => SLUG_RE.test(normalizeSlug(value));

function slugFromSubdomain(hostname) {
  const host = hostname.toLowerCase();
  // Desarrollo: demo.localhost
  if (host.endsWith('.localhost')) return host.slice(0, -'.localhost'.length).split('.').pop();
  // Producción: solo con un dominio base configurado explícitamente (adivinarlo
  // confundiría hosts como "app.vercel.app" o "www.colegio.com").
  const base = (import.meta.env.VITE_TENANT_BASE_DOMAIN || '').toLowerCase().replace(/^\./, '');
  if (base && host.endsWith(`.${base}`)) {
    const sub = host.slice(0, -(base.length + 1));
    if (sub && !sub.includes('.') && sub !== 'www') return sub;
  }
  return null;
}

/** { slug, source: 'url' | 'subdomain' | 'remembered' | null } */
export function resolveTenantSlug(location = window.location) {
  const params = new URLSearchParams(location.search);
  const fromUrl = normalizeSlug(params.get('colegio') || params.get('tenant'));
  if (isValidSlug(fromUrl)) return { slug: fromUrl, source: 'url' };

  const fromHost = normalizeSlug(slugFromSubdomain(location.hostname));
  if (isValidSlug(fromHost)) return { slug: fromHost, source: 'subdomain' };

  const remembered = normalizeSlug(readRemembered());
  if (isValidSlug(remembered)) return { slug: remembered, source: 'remembered' };

  return { slug: '', source: null };
}

function readRemembered() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // modo privado / almacenamiento bloqueado
  }
}

export function rememberTenantSlug(slug) {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeSlug(slug));
  } catch {
    // sin almacenamiento: simplemente no se recuerda
  }
}

export function forgetTenantSlug() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}

// ---------------------------------------------------------------------------
// Aviso "la marca cambió": Configuración lo emite al guardar y el login (en
// cualquier otra pestaña) vuelve a pedir el branding. El evento `storage` del
// navegador solo se dispara en las OTRAS pestañas del mismo origen.
// ---------------------------------------------------------------------------

export const BRANDING_UPDATED_KEY = 'ui.brandingUpdatedAt';

export function notifyBrandingChanged() {
  try {
    localStorage.setItem(BRANDING_UPDATED_KEY, String(Date.now()));
  } catch {
    // sin almacenamiento: las otras pestañas se actualizarán al volver a enfocarlas
  }
}
