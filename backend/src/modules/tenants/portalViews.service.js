const { ApiError } = require('../../utils/ApiError');

/**
 * Vistas del portal del representante (migración 066): el Administrador
 * decide qué secciones ve la familia. Se guardan en
 * tenant_settings.portal_views ({ clave: true|false }); una clave ausente
 * cuenta como activa.
 *
 * Se aplican en dos lugares:
 *   - frontend: menú, pestañas de la ficha del alumno y bloques del inicio
 *     (lee `portalViews` de /tenant/profile, que carga toda sesión);
 *   - backend: las rutas del portal de cada sección responden 403 si está
 *     desactivada (requirePortalView), así no basta con conocer la URL.
 */
const CATALOG = [
  // Menú y página de inicio
  { key: 'payments', group: 'menu', label: 'Mis pagos', description: 'Cuotas por pagar, reportar pagos (también agrupados) y recibos.', icon: 'receipt' },
  { key: 'events', group: 'menu', label: 'Cartelera de eventos', description: 'Eventos y actividades del colegio, en el menú y en el inicio.', icon: 'calendar' },
  { key: 'appointments', group: 'menu', label: 'Citas con el colegio', description: 'Ver las citas y confirmar asistencia desde el inicio.', icon: 'clock' },
  // Ficha de cada alumno
  { key: 'grades', group: 'student', label: 'Calificaciones', description: 'Notas por materia y el contenido de cada materia con sus evaluaciones.', icon: 'trendingUp' },
  { key: 'evaluation_plan', group: 'student', label: 'Plan de evaluación', description: 'Los planes de evaluación publicados de cada materia.', icon: 'clipboard' },
  { key: 'evaluations', group: 'student', label: 'Evaluaciones', description: 'Cronograma de evaluaciones de la sección.', icon: 'calendar' },
  { key: 'schedule', group: 'student', label: 'Horario', description: 'Horario de clases de la sección.', icon: 'clock' },
  { key: 'history', group: 'student', label: 'Historial académico', description: 'Resultados de años escolares anteriores.', icon: 'book' },
  { key: 'recognitions', group: 'student', label: 'Reconocimientos', description: 'Logros otorgados por el colegio y sus certificados.', icon: 'award' },
  { key: 'discipline', group: 'student', label: 'Convivencia', description: 'Registro de sanciones y amonestaciones.', icon: 'shield' },
  { key: 'clubs', group: 'student', label: 'Clubes', description: 'Clubes y actividades extracurriculares en que está inscrito.', icon: 'star' },
];
const KEYS = CATALOG.map((v) => v.key);

/** { clave: true|false } con todas las claves del catálogo (las ausentes = true). */
async function getPortalViews(trx, tenantId) {
  const row = await trx('tenant_settings').where({ tenant_id: tenantId }).first('portal_views');
  const stored = row?.portal_views || {};
  return Object.fromEntries(KEYS.map((k) => [k, stored[k] !== false]));
}

/** Para la pestaña de Configuración: el catálogo con su estado. */
async function listPortalViews(trx, tenantId) {
  const views = await getPortalViews(trx, tenantId);
  return { views: CATALOG.map((v) => ({ ...v, enabled: views[v.key] })) };
}

/** Guarda uno o varios cambios ({ payments: false, … }), fusionándolos con lo guardado. */
async function savePortalViews(trx, tenantId, changes) {
  const current = await getPortalViews(trx, tenantId);
  const next = { ...current, ...changes };
  await trx('tenant_settings')
    .insert({ tenant_id: tenantId, portal_views: JSON.stringify(next), updated_at: trx.fn.now() })
    .onConflict('tenant_id')
    .merge({ portal_views: JSON.stringify(next), updated_at: trx.fn.now() });
  return listPortalViews(trx, tenantId);
}

/**
 * Middleware: 403 si la sección del portal está desactivada para el colegio.
 * Se pone solo en las rutas de la FAMILIA (/portal/*, /payments/mine,
 * reportar pagos, pagos agrupados de la familia): las de la administración
 * (/payments, /events, /appointments…) no cambian.
 */
function requirePortalView(key) {
  if (!KEYS.includes(key)) throw new Error(`Vista del portal desconocida: ${key}`);
  return async (req, res, next) => {
    try {
      const views = await getPortalViews(req.db, req.tenantId);
      if (!views[key]) {
        const label = CATALOG.find((v) => v.key === key).label;
        throw ApiError.forbidden(`El colegio desactivó la sección «${label}» del portal.`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { CATALOG, KEYS, getPortalViews, listPortalViews, savePortalViews, requirePortalView };
