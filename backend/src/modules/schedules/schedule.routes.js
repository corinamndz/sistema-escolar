const router = require('express').Router();
const controller = require('./schedule.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const { denyTeachers } = require('../access/teacherScope');

router.use(authMiddleware, tenantMiddleware);

// Administración del horario: módulo "schedules"; los docentes no editan (403).
const admin = (action) => [denyTeachers, requirePermission('schedules', action)];

// Consulta de solo lectura (sin permiso de módulo: se filtra por el usuario).
router.get('/mine', controller.mySchedule);
router.get('/sections/:id', controller.getSectionSchedule); // docente: sus secciones; administración: todas
// Horario de evaluaciones (sincronizado con los planes): mismo acceso que el horario de la sección.
router.get('/evaluations', controller.getEvaluationCalendar);
router.get('/evaluations/pdf', controller.downloadEvaluationPdf);

// Consulta filtrada por grado/sección o por docente (auditoría de carga).
router.get('/', admin('read'), controller.querySchedule);
router.get('/teachers', admin('read'), controller.listTeachers);
router.get('/grades', admin('read'), controller.listGrades);
router.get('/assignments', admin('read'), controller.listAssignments);
router.get('/pdf', admin('read'), controller.downloadPdf);
router.get('/sections', admin('read'), controller.listSections);
router.get('/periods', admin('read'), controller.listPeriods);
router.get('/periods/:periodId/slots', admin('read'), controller.listSlots);
router.put('/periods/:periodId/slots', admin('update'), controller.saveSlots);
router.post('/sections/:id/entries', admin('update'), controller.placeEntry);
router.put('/entries/:id', admin('update'), controller.moveEntry);
router.delete('/entries/:id', admin('update'), controller.removeEntry);

// Generador automático: genera una vista previa; se guarda solo al aplicarla.
router.post('/periods/:periodId/generate', admin('update'), controller.generate);
router.get('/generations/:id', admin('read'), controller.getGeneration);
router.post('/generations/:id/apply', admin('update'), controller.applyGeneration);
router.delete('/generations/:id', admin('update'), controller.discardGeneration);
// Disponibilidad de cada docente (bloques en que no puede dar clase).
router.get('/periods/:periodId/unavailability/:staffId', admin('read'), controller.getUnavailability);
router.put('/periods/:periodId/unavailability/:staffId', admin('update'), controller.saveUnavailability);

module.exports = router;
