const router = require('express').Router();
const controller = require('./academic.controller');
const assignments = require('./assignment.controller');
const promotion = require('./promotion.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

router.use(authMiddleware, tenantMiddleware);

const read = requirePermission('academics', 'read');
const create = requirePermission('academics', 'create');
const update = requirePermission('academics', 'update');
const remove = requirePermission('academics', 'delete');
// Cierre de año y promoción: módulo propio ("promotion"), vedado a los docentes (403).
const promo = (action) => [scope.denyTeachers, requirePermission('promotion', action)];
const ownSection = scope.guardParam(scope.assertSectionAccess, 'id');

router.get('/levels', read, assignments.listLevels);

router.get('/school-periods', read, controller.listSchoolPeriods);
router.post('/school-periods', create, controller.createSchoolPeriod);
// Cierre de año escolar ("Finalizado") y reapertura para corregir.
router.get('/school-periods/:id/evaluation-rules', promo('read'), promotion.getRules);
router.put('/school-periods/:id/evaluation-rules', promo('update'), promotion.updateRules);
router.post('/school-periods/:id/close', promo('update'), promotion.closePeriod);
router.post('/school-periods/:id/reopen', promo('update'), promotion.reopenPeriod);

// Promoción de alumnos al cerrar el año (vista previa, ejecución, deshacer).
router.get('/promotion/preview', promo('read'), promotion.preview);
router.post('/promotion', promo('update'), promotion.execute);
router.post('/promotion/:enrollmentId/undo', promo('update'), promotion.undo);

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
// Docente: solo las secciones de su carga (las demás → 404).
router.get('/sections/:id', read, ownSection, controller.getSection);
router.put('/sections/:id', update, ownSection, controller.updateSection);
router.get('/sections/:id/roster', read, ownSection, controller.getRoster);
router.get('/sections/:id/teachers', read, ownSection, assignments.getSectionAssignments);
router.put('/sections/:id/teachers', update, assignments.setSectionAssignments);

router.get('/teaching-load', read, assignments.listTeachingLoad);

router.post('/enrollments', update, controller.enroll);
router.delete('/enrollments/:id', update, controller.withdraw);

module.exports = router;
