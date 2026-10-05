/**
 * Catálogo estático de módulos del sistema. Debe reflejar 1:1 las filas de
 * la tabla `modules` (ver seeders/001_modules_and_roles.js). Se usa para:
 *  - poblar la tabla `modules` al hacer seed,
 *  - que el frontend sepa qué claves de `extra_actions` puede pedir por
 *    módulo (acciones especiales más allá de CRUD).
 */
const MODULES = [
  { code: 'dashboard', label: 'Inicio', sortOrder: 0, extraActions: [] },
  { code: 'tenant_settings', label: 'Configuración del colegio', sortOrder: 1, extraActions: [] },
  { code: 'roles', label: 'Roles y permisos', sortOrder: 2, extraActions: [] },
  { code: 'staff', label: 'Personal', sortOrder: 3, extraActions: [] },
  { code: 'students', label: 'Alumnos', sortOrder: 4, extraActions: [] },
  { code: 'guardians', label: 'Representantes', sortOrder: 5, extraActions: [] },
  { code: 'academics', label: 'Grados, secciones y aulas', sortOrder: 6, extraActions: [] },
  { code: 'evaluation_plans', label: 'Planes de evaluación', sortOrder: 7, extraActions: [] },
  { code: 'grading', label: 'Calificaciones', sortOrder: 8, extraActions: ['view_all_sections'] },
  { code: 'payments', label: 'Pagos', sortOrder: 9, extraActions: ['approve_payment', 'export'] },
  // Cierre de año escolar y promoción de alumnos (separado de 'academics' para no dárselo a los docentes).
  { code: 'promotion', label: 'Cierre y promoción', sortOrder: 10, extraActions: [] },
];

const MODULE_CODES = MODULES.map((m) => m.code);

module.exports = { MODULES, MODULE_CODES };
