const router = require('express').Router();
const controller = require('./student.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

// Alumnos
router.get('/students', requirePermission('students', 'read'), controller.listStudents);
router.post('/students', requirePermission('students', 'create'), controller.createStudent);
router.get('/students/:id', requirePermission('students', 'read'), controller.getStudent);
router.put('/students/:id', requirePermission('students', 'update'), controller.updateStudent);
router.post('/students/:id/guardians', requirePermission('students', 'update'), controller.linkGuardian);
router.delete('/students/:id/guardians/:guardianId', requirePermission('students', 'update'), controller.unlinkGuardian);

// Representantes
router.get('/guardians', requirePermission('guardians', 'read'), controller.listGuardians);
router.post('/guardians', requirePermission('guardians', 'create'), controller.createGuardian);
router.get('/guardians/:id', requirePermission('guardians', 'read'), controller.getGuardian);
router.put('/guardians/:id', requirePermission('guardians', 'update'), controller.updateGuardian);

module.exports = router;
