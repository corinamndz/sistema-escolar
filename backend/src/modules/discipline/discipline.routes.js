const router = require('express').Router();
const controller = require('./discipline.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

router.use(authMiddleware, tenantMiddleware);

// Docente: solo alumnos inscritos en secciones de su carga (los demás → 404).
const ownStudent = scope.guardParam(scope.assertStudentAccess, 'studentId');
const can = (action) => requirePermission('discipline', action);

// Docente: solo consulta el historial de SUS alumnos desde la ficha del alumno.
router.get('/students/:studentId/sanctions', can('read'), ownStudent, controller.studentHistory);

// Módulo general y gestión (registrar, editar, eliminar): solo administración.
// Un docente restringido a su carga recibe 403 aunque se le dé el permiso.
const admin = (action) => [scope.denyTeachers, can(action)];
router.get('/sanctions', admin('read'), controller.list);
router.post('/students/:studentId/sanctions', admin('create'), controller.create);
router.put('/sanctions/:id', admin('update'), controller.update);
router.delete('/sanctions/:id', admin('delete'), controller.remove);

module.exports = router;
