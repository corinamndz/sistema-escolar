const router = require('express').Router();

// Rutas públicas (sin sesión): deben ir antes del montaje en '/', que exige autenticación.
router.use('/public', require('../modules/tenants/tenant.public'));
// Regreso desde Google al conectar la cuenta de correo del colegio (OAuth2).
router.use('/integrations', require('../modules/tenants/integrations.routes'));
router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/tenant', require('../modules/tenants/tenant.routes'));
router.use('/roles', require('../modules/roles/role.routes'));
router.use('/staff', require('../modules/staff/staff.routes'));
// Carga masiva por Excel (plantillas + validación + importación). Antes del montaje en '/'.
router.use('/imports', require('../modules/imports/import.routes'));
// Antes del montaje en '/': ese router aplica auth + tenant a todo lo que pasa por él.
router.use('/portal', require('../modules/portal/portal.routes'));
router.use('/', require('../modules/students/student.routes')); // expone /students y /guardians
router.use('/academics', require('../modules/academics/academic.routes'));
router.use('/evaluation-plans', require('../modules/evaluation-plans/evaluationPlan.routes'));
router.use('/grading', require('../modules/grading/grading.routes'));
router.use('/payments', require('../modules/payments/payment.routes'));
router.use('/exchange-rate', require('../modules/payments/exchangeRate.routes'));
router.use('/notifications', require('../modules/notifications/notification.routes'));
router.use('/schedules', require('../modules/schedules/schedule.routes'));
router.use('/discipline', require('../modules/discipline/discipline.routes'));
router.use('/clubs', require('../modules/clubs/club.routes'));
router.use('/events', require('../modules/events/event.routes'));

module.exports = router;
