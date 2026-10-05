const router = require('express').Router();
const controller = require('./student.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

// Docente: solo alumnos inscritos en secciones de su carga (los demás → 404).
const ownStudent = scope.guardParam(scope.assertStudentAccess, 'id');

router.use(authMiddleware, tenantMiddleware);

// Alumnos
router.get('/students', requirePermission('students', 'read'), controller.listStudents);
router.post('/students', requirePermission('students', 'create'), controller.createStudent);
router.get('/students/:id', requirePermission('students', 'read'), ownStudent, controller.getStudent);
router.get('/students/:id/academic-history', requirePermission('students', 'read'), ownStudent, controller.getAcademicHistory);
router.put('/students/:id', requirePermission('students', 'update'), ownStudent, controller.updateStudent);
router.post('/students/:id/guardians', requirePermission('students', 'update'), ownStudent, controller.linkGuardian);
router.delete('/students/:id/guardians/:guardianId', requirePermission('students', 'update'), ownStudent, controller.unlinkGuardian);

// Representantes
router.get('/guardians', requirePermission('guardians', 'read'), controller.listGuardians);
router.post('/guardians', requirePermission('guardians', 'create'), controller.createGuardian);
router.get('/guardians/:id', requirePermission('guardians', 'read'), controller.getGuardian);
router.put('/guardians/:id', requirePermission('guardians', 'update'), controller.updateGuardian);
router.delete('/guardians/:id', requirePermission('guardians', 'delete'), controller.deleteGuardian);

module.exports = router;
