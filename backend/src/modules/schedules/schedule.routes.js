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

router.get('/sections', admin('read'), controller.listSections);
router.get('/periods/:periodId/slots', admin('read'), controller.listSlots);
router.put('/periods/:periodId/slots', admin('update'), controller.saveSlots);
router.post('/sections/:id/entries', admin('update'), controller.placeEntry);
router.put('/entries/:id', admin('update'), controller.moveEntry);
router.delete('/entries/:id', admin('update'), controller.removeEntry);

module.exports = router;
