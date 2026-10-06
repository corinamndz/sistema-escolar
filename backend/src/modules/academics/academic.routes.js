const router = require('express').Router();
const controller = require('./academic.controller');
const assignments = require('./assignment.controller');
const promotion = require('./promotion.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

// Grados y secciones es configuración administrativa del colegio: los docentes
// restringidos a su carga no acceden a NINGUNA ruta de este módulo (403). Lo que
// necesitan para sus planes lo piden a /evaluation-plans/options/* (filtrado).
router.use(authMiddleware, tenantMiddleware, scope.denyTeachers);

const read = requirePermission('academics', 'read');
const create = requirePermission('academics', 'create');
const update = requirePermission('academics', 'update');
const remove = requirePermission('academics', 'delete');
// Cierre de año y promoción: módulo propio ("promotion").
const promo = (action) => requirePermission('promotion', action);

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
// Panel unificado del grado (materias, docentes y secciones del año en una consulta).
router.get('/grades/:id/panel', read, assignments.getGradePanel);
router.put('/grades/:id/subjects', update, assignments.setGradeSubjects);

router.get('/subjects', read, assignments.listSubjects);
router.post('/subjects', create, assignments.createSubject);
router.put('/subjects/:id', update, assignments.updateSubject);
router.delete('/subjects/:id', remove, assignments.deleteSubject);

router.get('/sections', read, controller.listSections);
router.post('/sections', create, controller.createSection);
router.get('/sections/:id', read, controller.getSection);
router.put('/sections/:id', update, controller.updateSection);
router.delete('/sections/:id', remove, controller.deleteSection);
router.get('/sections/:id/roster', read, controller.getRoster);
router.get('/sections/:id/teachers', read, assignments.getSectionAssignments);
router.put('/sections/:id/teachers', update, assignments.setSectionAssignments);

router.get('/teaching-load', read, assignments.listTeachingLoad);

router.post('/enrollments', update, controller.enroll);
router.delete('/enrollments/:id', update, controller.withdraw);

module.exports = router;
