/**
 * Catálogo de la bitácora: cómo se nombra cada acción registrada sola por
 * tenant.middleware. La clave es "MÉTODO /ruta" tal como la declara Express
 * (sin /api). Las rutas que no están aquí reciben un nombre por defecto a
 * partir del método y el módulo ("ACTUALIZAR_ALUMNO", "Actualizó un registro
 * de Alumnos"), así que una ruta nueva queda auditada sin tocar este archivo.
 */

const MODULES = {
  auth: { label: 'Sesión', noun: 'SESION' },
  tenant_settings: { label: 'Configuración', noun: 'CONFIGURACION' },
  roles: { label: 'Roles y permisos', noun: 'ROL' },
  staff: { label: 'Personal', noun: 'PERSONAL' },
  imports: { label: 'Importaciones', noun: 'IMPORTACION' },
  portal: { label: 'Portal de padres', noun: 'PORTAL' },
  students: { label: 'Alumnos', noun: 'ALUMNO' },
  guardians: { label: 'Representantes', noun: 'REPRESENTANTE' },
  academics: { label: 'Académico', noun: 'ACADEMICO' },
  promotion: { label: 'Cierre y promoción', noun: 'PROMOCION' },
  evaluation_plans: { label: 'Planes de evaluación', noun: 'PLAN' },
  programmatic_content: { label: 'Contenido programático', noun: 'CONTENIDO' },
  grading: { label: 'Calificaciones', noun: 'CALIFICACION' },
  payments: { label: 'Pagos', noun: 'PAGO' },
  notifications: { label: 'Notificaciones', noun: 'NOTIFICACION' },
  schedules: { label: 'Horarios', noun: 'HORARIO' },
  discipline: { label: 'Convivencia', noun: 'SANCION' },
  clubs: { label: 'Clubes', noun: 'CLUB' },
  events: { label: 'Eventos', noun: 'EVENTO' },
  appointments: { label: 'Citas con padres', noun: 'CITA' },
};

const SEGMENT_MODULE = {
  auth: 'auth',
  tenant: 'tenant_settings',
  integrations: 'tenant_settings',
  roles: 'roles',
  staff: 'staff',
  imports: 'imports',
  portal: 'portal',
  students: 'students',
  guardians: 'guardians',
  academics: 'academics',
  'evaluation-plans': 'evaluation_plans',
  'programmatic-content': 'programmatic_content',
  reviews: 'evaluation_plans', // revisión de planes y contenido (migración 058)
  grading: 'grading',
  payments: 'payments',
  'exchange-rate': 'payments',
  notifications: 'notifications',
  schedules: 'schedules',
  discipline: 'discipline',
  clubs: 'clubs',
  events: 'events',
  appointments: 'appointments',
};

/** No se registran: no cambian datos del colegio o son ruido (marcar leído, validar antes de importar…). */
const IGNORED = new Set([
  'POST /auth/login', // se registra aparte (éxito y fallo), ver auth.service
  'POST /auth/refresh',
  'POST /imports/:type/validate',
  'POST /evaluation-plans/activity-template/parse',
  'POST /notifications/read-all',
  'POST /notifications/:id/read',
  'POST /payments/batches/quote', // solo cotiza
]);

/** [acción, frase en pasado] — a la frase se le agrega «nombre del registro» si se conoce. */
const ACTIONS = {
  'POST /auth/change-password': ['CAMBIAR_CONTRASENA', 'Cambió su contraseña'],

  'PUT /tenant/settings': ['ACTUALIZAR_CONFIGURACION', 'Actualizó la configuración del colegio'],
  'PUT /tenant/grading-scales': ['ACTUALIZAR_ESCALAS', 'Actualizó las escalas de calificación'],
  'POST /tenant/payment-accounts': ['CREAR_CUENTA_PAGO', 'Agregó la cuenta de pago'],
  'PUT /tenant/payment-accounts/:id': ['ACTUALIZAR_CUENTA_PAGO', 'Actualizó la cuenta de pago'],
  'DELETE /tenant/payment-accounts/:id': ['ELIMINAR_CUENTA_PAGO', 'Eliminó una cuenta de pago'],
  'PUT /tenant/mail-settings': ['ACTUALIZAR_CORREO', 'Actualizó la configuración de correo'],
  'DELETE /tenant/mail-settings': ['ELIMINAR_CORREO', 'Quitó la configuración de correo'],
  'POST /tenant/mail-settings/test': ['PROBAR_CORREO', 'Envió un correo de prueba'],
  'PUT /tenant/notification-preferences': ['ACTUALIZAR_AVISOS', 'Actualizó las preferencias de avisos'],
  'PUT /tenant/academic-settings': ['ACTUALIZAR_REVISION_ACADEMICA', 'Cambió si el contenido programático requiere revisión'],

  'POST /roles': ['CREAR_ROL', 'Creó el rol'],
  'PUT /roles/:id': ['ACTUALIZAR_ROL', 'Actualizó el rol'],
  'DELETE /roles/:id': ['ELIMINAR_ROL', 'Eliminó un rol'],
  'PUT /roles/:id/permissions': ['ACTUALIZAR_PERMISOS', 'Cambió los permisos del rol'],

  'POST /staff': ['CREAR_PERSONAL', 'Registró a'],
  'PUT /staff/:id': ['ACTUALIZAR_PERSONAL', 'Actualizó la ficha de'],
  'DELETE /staff/:id': ['ELIMINAR_PERSONAL', 'Eliminó una ficha de personal'],
  'POST /staff/:id/access': ['CREAR_USUARIO', 'Creó el usuario de acceso de personal'],
  'PUT /staff/:id/access': ['ACTUALIZAR_USUARIO', 'Cambió el usuario de acceso de personal'],

  'POST /imports/:type': ['IMPORTAR_DATOS', 'Importó datos desde Excel'],

  'POST /students': ['CREAR_ALUMNO', 'Registró al alumno'],
  'PUT /students/:id': ['ACTUALIZAR_ALUMNO', 'Actualizó la ficha del alumno'],
  'POST /students/:id/guardians': ['ASOCIAR_REPRESENTANTE', 'Asoció un representante al alumno'],
  'DELETE /students/:id/guardians/:guardianId': ['DESASOCIAR_REPRESENTANTE', 'Quitó un representante del alumno'],
  'POST /guardians': ['CREAR_REPRESENTANTE', 'Registró al representante'],
  'PUT /guardians/:id': ['ACTUALIZAR_REPRESENTANTE', 'Actualizó la ficha del representante'],
  'DELETE /guardians/:id': ['ELIMINAR_REPRESENTANTE', 'Eliminó un representante'],

  'POST /academics/school-periods': ['CREAR_ANIO_ESCOLAR', 'Creó el año escolar'],
  'DELETE /academics/school-periods/:id': ['ELIMINAR_ANIO_ESCOLAR', 'Eliminó un año escolar con todos sus datos'],
  'POST /academics/school-periods/:id/rollover': ['COPIAR_ESTRUCTURA_ANIO', 'Copió la estructura académica a un año nuevo'],
  'PUT /academics/school-periods/:id/evaluation-rules': ['ACTUALIZAR_NORMATIVA', 'Cambió la normativa de evaluación del año'],
  'POST /academics/school-periods/:id/close': ['CERRAR_ANIO_ESCOLAR', 'Finalizó el año escolar'],
  'POST /academics/school-periods/:id/reopen': ['REABRIR_ANIO_ESCOLAR', 'Reabrió el año escolar'],
  'POST /academics/promotion': ['PROMOVER_ALUMNOS', 'Procesó la promoción de alumnos'],
  'POST /academics/promotion/:enrollmentId/undo': ['DESHACER_PROMOCION', 'Deshizo la promoción de un alumno'],
  'POST /academics/grades': ['CREAR_GRADO', 'Creó el grado'],
  'PUT /academics/grades/:id': ['ACTUALIZAR_GRADO', 'Actualizó el grado'],
  'POST /academics/subjects': ['CREAR_MATERIA', 'Creó la materia'],
  'PUT /academics/subjects/:id': ['ACTUALIZAR_MATERIA', 'Actualizó la materia'],
  'DELETE /academics/subjects/:id': ['ELIMINAR_MATERIA', 'Eliminó una materia'],
  'PUT /academics/subjects/:id/assignments': ['ASIGNAR_MATERIA', 'Cambió dónde se dicta la materia y sus docentes'],
  'POST /academics/sections': ['CREAR_SECCION', 'Creó la sección'],
  'PUT /academics/sections/:id': ['ACTUALIZAR_SECCION', 'Actualizó la sección'],
  'DELETE /academics/sections/:id': ['ELIMINAR_SECCION', 'Eliminó una sección'],
  'PUT /academics/sections/:id/teachers': ['ASIGNAR_DOCENTES', 'Cambió los docentes de la sección'],
  'POST /academics/enrollments': ['INSCRIBIR_ALUMNO', 'Inscribió a un alumno en una sección'],
  'POST /academics/enrollments/bulk': ['INSCRIBIR_ALUMNOS', 'Inscribió alumnos en una sección'],
  'DELETE /academics/enrollments/:id': ['RETIRAR_ALUMNO', 'Retiró a un alumno de su sección'],

  'POST /evaluation-plans': ['CREAR_PLAN', 'Creó un plan de evaluación'],
  'POST /evaluation-plans/:planId/close': ['CERRAR_PLAN', 'Cerró un plan de evaluación'],

  'POST /reviews/plans/:planId/submit': ['ENVIAR_PLAN_REVISION', 'Envió un plan de evaluación a revisión'],
  'POST /reviews/plans/:planId/review': ['REVISAR_PLAN', 'Revisó un plan de evaluación (aprobó, pidió ajustes o lo reabrió)'],
  'POST /reviews/plans/:planId/comments': ['COMENTAR_PLAN', 'Comentó la revisión de un plan de evaluación'],
  'POST /reviews/contents/:gradeId/:subjectId/submit': ['ENVIAR_CONTENIDO_REVISION', 'Envió un contenido programático a revisión'],
  'POST /reviews/contents/:gradeId/:subjectId/review': ['REVISAR_CONTENIDO', 'Revisó un contenido programático (aprobó, pidió ajustes o lo reabrió)'],
  'POST /reviews/contents/:gradeId/:subjectId/comments': ['COMENTAR_CONTENIDO', 'Comentó la revisión de un contenido programático'],
  'POST /evaluation-plans/:planId/reopen': ['REABRIR_PLAN', 'Reabrió un plan de evaluación'],
  'POST /evaluation-plans/:planId/activities': ['CREAR_ACTIVIDAD', 'Creó la actividad'],
  'PUT /evaluation-plans/:planId/activities/:activityId': ['ACTUALIZAR_ACTIVIDAD', 'Actualizó la actividad'],
  'DELETE /evaluation-plans/:planId/activities/:activityId': ['ELIMINAR_ACTIVIDAD', 'Eliminó una actividad evaluativa'],

  'PUT /grading/activities/:activityId/scores': ['REGISTRAR_NOTA', 'Registró o cambió una calificación'],

  'POST /payments': ['CREAR_COBRO', 'Registró el cobro'],
  'POST /payments/:id/report': ['REPORTAR_PAGO', 'Reportó un pago'],
  'POST /payments/batches': ['REPORTAR_PAGO_AGRUPADO', 'Reportó un pago agrupado'],
  'POST /payments/batches/:id/withdraw': ['RETIRAR_PAGO_AGRUPADO', 'Retiró el pago agrupado'],
  'POST /payments/batches/:id/approve': ['APROBAR_PAGO_AGRUPADO', 'Aprobó el pago agrupado'],
  'POST /payments/batches/:id/reject': ['RECHAZAR_PAGO_AGRUPADO', 'Rechazó el pago agrupado'],
  'POST /payments/:id/mark-paid': ['CONFIRMAR_PAGO', 'Confirmó el pago'],
  'POST /payments/:id/cancel': ['ANULAR_PAGO', 'Anuló el cobro'],
  'POST /payments/:id/receipt': ['REGENERAR_RECIBO', 'Regeneró el recibo del pago'],
  'POST /payments/tuition/generate': ['GENERAR_MENSUALIDADES', 'Generó las mensualidades del año'],
  'PUT /payments/tuition/fees': ['ACTUALIZAR_TARIFA', 'Cambió una tarifa de mensualidad'],
  'DELETE /payments/tuition/fees/:id': ['ELIMINAR_TARIFA', 'Eliminó una tarifa de mensualidad'],
  'PUT /payments/currencies': ['ACTUALIZAR_MONEDAS', 'Cambió las monedas del colegio'],
  'POST /payments/currencies': ['CREAR_MONEDA', 'Agregó la moneda'],
  'PUT /payments/currencies/:code': ['ACTUALIZAR_MONEDA', 'Actualizó la moneda'],
  'DELETE /payments/currencies/:code': ['ELIMINAR_MONEDA', 'Eliminó una moneda'],
  'PUT /payments/exchange-rates': ['ACTUALIZAR_TASA', 'Registró la tasa del día'],
  'POST /payments/exchange-rates/bcv': ['ACTUALIZAR_TASA_BCV', 'Actualizó la tasa desde el BCV'],
  'DELETE /payments/exchange-rates/:id': ['ELIMINAR_TASA', 'Eliminó una tasa de cambio'],
  'POST /exchange-rate/sync': ['ACTUALIZAR_TASA_BCV', 'Actualizó la tasa desde el BCV'],
  'POST /exchange-rate/simulate': ['SIMULAR_TASA_BCV', 'Simuló un aviso de tasa BCV'],
  'DELETE /exchange-rate/simulate': ['LIMPIAR_SIMULACION_BCV', 'Borró las simulaciones de tasa BCV'],

  'POST /notifications/log/:source/:id/resend': ['REENVIAR_NOTIFICACION', 'Reenvió una notificación'],

  'PUT /schedules/periods/:periodId/slots': ['ACTUALIZAR_BLOQUES', 'Cambió los bloques horarios'],
  'POST /schedules/periods/:periodId/generate': ['GENERAR_HORARIO', 'Generó una propuesta de horario'],
  'POST /schedules/generations/:id/apply': ['APLICAR_HORARIO', 'Aplicó un horario generado'],

  'POST /discipline/students/:studentId/sanctions': ['REGISTRAR_SANCION', 'Registró una sanción'],
  'PUT /discipline/sanctions/:id': ['ACTUALIZAR_SANCION', 'Actualizó una sanción'],
  'DELETE /discipline/sanctions/:id': ['ELIMINAR_SANCION', 'Eliminó una sanción'],

  'POST /clubs/enroll': ['INSCRIBIR_EN_CLUB', 'Inscribió alumnos en un club'],
  'PUT /clubs/memberships/:id/withdraw': ['RETIRAR_DE_CLUB', 'Retiró a un alumno de un club'],

  'POST /appointments/:id/resend': ['REENVIAR_CITA', 'Reenvió el aviso de una cita'],
  'POST /portal/appointments/:id/confirm': ['CONFIRMAR_CITA', 'Confirmó la asistencia a una cita'],
};

const VERB = { POST: ['CREAR', 'Creó'], PUT: ['ACTUALIZAR', 'Actualizó'], PATCH: ['ACTUALIZAR', 'Actualizó'], DELETE: ['ELIMINAR', 'Eliminó'] };

function moduleOf(route) {
  if (/^\/academics\/(promotion|school-periods\/:id\/(close|reopen|evaluation-rules))/.test(route)) return 'promotion';
  return SEGMENT_MODULE[route.split('/')[1]] || 'tenant_settings';
}

/** { action, module, phrase } para "MÉTODO /ruta", o null si no se registra. */
function describe(method, route) {
  const key = `${method} ${route}`;
  if (IGNORED.has(key)) return null;
  const module = moduleOf(route);
  const known = ACTIONS[key];
  if (known) return { action: known[0], module, phrase: known[1] };
  const [verb, past] = VERB[method] || ['MODIFICAR', 'Modificó'];
  return { action: `${verb}_${MODULES[module]?.noun || 'REGISTRO'}`, module, phrase: `${past} un registro de ${MODULES[module]?.label || module}` };
}

const moduleLabel = (code) => MODULES[code]?.label || code;

module.exports = { MODULES, describe, moduleLabel };
