const router = require('express').Router();
const controller = require('./academic.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

router.get('/school-periods', requirePermission('academics', 'read'), controller.listSchoolPeriods);
router.post('/school-periods', requirePermission('academics', 'create'), controller.createSchoolPeriod);

router.get('/classrooms', requirePermission('academics', 'read'), controller.listClassrooms);
router.post('/classrooms', requirePermission('academics', 'create'), controller.createClassroom);

router.get('/grades', requirePermission('academics', 'read'), controller.listGrades);
router.post('/grades', requirePermission('academics', 'create'), controller.createGrade);

router.get('/sections', requirePermission('academics', 'read'), controller.listSections);
router.post('/sections', requirePermission('academics', 'create'), controller.createSection);
router.get('/sections/:id', requirePermission('academics', 'read'), controller.getSection);
router.put('/sections/:id', requirePermission('academics', 'update'), controller.updateSection);
router.get('/sections/:id/roster', requirePermission('academics', 'read'), controller.getRoster);

router.post('/enrollments', requirePermission('academics', 'update'), controller.enroll);
router.delete('/enrollments/:id', requirePermission('academics', 'update'), controller.withdraw);

module.exports = router;
