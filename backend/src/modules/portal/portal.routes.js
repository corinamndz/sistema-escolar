const router = require('express').Router();
const controller = require('./portal.controller');
const paymentAccounts = require('../payments/paymentAccounts.controller');
const events = require('../events/event.controller');
const appointments = require('../appointments/appointment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
// Secciones que el colegio puede desactivar (Configuración → Vistas del representante): 403 si lo están.
const { requirePortalView: view } = require('../tenants/portalViews.service');

// Sin requirePermission: los datos se filtran por el usuario autenticado
// (igual que GET /payments/mine), así que no hace falta ningún permiso de módulo.
router.use(authMiddleware, tenantMiddleware);

router.get('/me', controller.getMyPortal);
// Citas con el colegio de la familia: verlas y confirmar asistencia.
router.get('/appointments', view('appointments'), appointments.myAppointments);
router.post('/appointments/:id/confirm', view('appointments'), appointments.confirmMine);
router.get('/students/:studentId/grades', view('grades'), controller.getStudentGrades);
// Materias pendientes del año anterior, con el avance de sus momentos de recuperación.
router.get('/students/:studentId/carryovers', view('grades'), controller.getStudentCarryovers);
router.get('/students/:studentId/evaluation-plans/:planId', view('evaluation_plan'), controller.getStudentPlanDetail);
// Constancia "He leído y acepto el plan de evaluación" (069).
router.post('/students/:studentId/evaluation-plans/:planId/acknowledge', view('evaluation_plan'), controller.acknowledgePlan);
// Contenido programático de una materia con sus evaluaciones publicadas (sección del alumno).
router.get('/students/:studentId/subjects/:subjectId/program', view('grades'), controller.getStudentSubjectProgram);
router.get('/students/:studentId/history', view('history'), controller.getStudentHistory);
// Certificado de promoción: mismas reglas que el historial (bloqueado con cuotas vencidas).
router.get('/students/:studentId/certificate', view('history'), controller.getStudentCertificate);
router.get('/students/:studentId/schedule', view('schedule'), controller.getStudentSchedule);
router.get('/students/:studentId/sanctions', view('discipline'), controller.getStudentSanctions);
router.get('/students/:studentId/recognitions', view('recognitions'), controller.getStudentRecognitions);
router.get('/students/:studentId/recognitions/:id/certificate', view('recognitions'), controller.getRecognitionCertificate);
// Cronograma de evaluaciones de la sección del alumno (solo de sus representados).
router.get('/students/:studentId/evaluations', view('evaluations'), controller.getStudentEvaluations);
// Clubes y actividades extracurriculares del alumno.
router.get('/students/:studentId/clubs', view('clubs'), controller.getStudentClubs);
// Cartelera de eventos del colegio (los de todo el colegio y los del grado/sección de sus hijos).
router.get('/events', view('events'), events.portalList);
// Datos de pago del colegio (activos) para reportar un pago.
router.get('/payment-accounts', view('payments'), paymentAccounts.listPublic);

module.exports = router;
