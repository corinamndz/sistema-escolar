const router = require('express').Router();
const controller = require('./academic.controller');
const assignments = require('./assignment.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

const read = requirePermission('academics', 'read');
const create = requirePermission('academics', 'create');
const update = requirePermission('academics', 'update');
const remove = requirePermission('academics', 'delete');

router.get('/levels', read, assignments.listLevels);

router.get('/school-periods', read, controller.listSchoolPeriods);
router.post('/school-periods', create, controller.createSchoolPeriod);

router.get('/classrooms', read, controller.listClassrooms);
router.post('/classrooms', create, controller.createClassroom);

router.get('/grades', read, controller.listGrades);
router.post('/grades', create, controller.createGrade);
router.put('/grades/:id', update, controller.updateGrade);
router.get('/grades/:id/subjects', read, assignments.getGradeSubjects);
router.put('/grades/:id/subjects', update, assignments.setGradeSubjects);

router.get('/subjects', read, assignments.listSubjects);
router.post('/subjects', create, assignments.createSubject);
router.put('/subjects/:id', update, assignments.updateSubject);
router.delete('/subjects/:id', remove, assignments.deleteSubject);

router.get('/sections', read, controller.listSections);
router.post('/sections', create, controller.createSection);
router.get('/sections/:id', read, controller.getSection);
router.put('/sections/:id', update, controller.updateSection);
router.get('/sections/:id/roster', read, controller.getRoster);
router.get('/sections/:id/teachers', read, assignments.getSectionAssignments);
router.put('/sections/:id/teachers', update, assignments.setSectionAssignments);

router.get('/teaching-load', read, assignments.listTeachingLoad);

router.post('/enrollments', update, controller.enroll);
router.delete('/enrollments/:id', update, controller.withdraw);

module.exports = router;
