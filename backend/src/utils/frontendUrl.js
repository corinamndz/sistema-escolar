/**
 * Enlaces a la app web. El colegio va en la ruta: {FRONTEND_URL}/<slug>/<página>
 * (ver frontend/src/lib/tenantPath.js). Sin slug, la app redirige al último
 * colegio usado en ese navegador o muestra el login genérico.
 */
const frontendBase = () => (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

function tenantAppUrl(slug, path = '/') {
  const page = path.startsWith('/') ? path : `/${path}`;
  return `${frontendBase()}${slug ? `/${encodeURIComponent(slug)}` : ''}${page}`;
}

module.exports = { frontendBase, tenantAppUrl };
