/**
 * Acciones especiales por módulo (más allá de crear/leer/actualizar/eliminar).
 * Debe reflejar `extraActions` de backend/src/config/modules.js — el backend
 * acepta cualquier clave en `extra_actions` (es JSONB), pero el frontend solo
 * necesita saber cuáles mostrar como checkboxes en el editor de permisos.
 */
const EXTRA_ACTIONS_BY_MODULE = {
  grading: [{ key: 'view_all_sections', label: 'Ver calificaciones de todas las secciones' }],
  payments: [
    { key: 'approve_payment', label: 'Marcar pagos como pagados (dispara el correo)' },
    { key: 'export', label: 'Exportar reportes de pagos' },
  ],
};

export { EXTRA_ACTIONS_BY_MODULE };
