const router = require('express').Router();
const controller = require('./evaluationPlan.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');

// Docente: solo los planes de las materias y secciones de su carga (los demás → 404).
const ownPlan = (param) => scope.guardParam(scope.assertPlanAccess, param);
const ownProject = scope.guardParam(scope.assertProjectAccess, 'projectId');

router.use(authMiddleware, tenantMiddleware);

router.get('/terms', requirePermission('evaluation_plans', 'read'), controller.listTerms);
router.post('/terms', requirePermission('evaluation_plans', 'create'), controller.createTerm);

router.get('/', requirePermission('evaluation_plans', 'read'), controller.listPlans);
router.post('/', requirePermission('evaluation_plans', 'create'), controller.createPlan);
router.get('/:id', requirePermission('evaluation_plans', 'read'), ownPlan('id'), controller.getPlan);
router.put('/:planId', requirePermission('evaluation_plans', 'update'), ownPlan('planId'), controller.updatePlan);

router.post('/:planId/project', requirePermission('evaluation_plans', 'create'), ownPlan('planId'), controller.createProject);
router.post('/projects/:projectId/competencies', requirePermission('evaluation_plans', 'update'), ownProject, controller.addCompetency);

router.post('/:planId/activities', requirePermission('evaluation_plans', 'create'), ownPlan('planId'), controller.createActivity);
router.put('/:planId/activities/:activityId', requirePermission('evaluation_plans', 'update'), ownPlan('planId'), controller.updateActivity);
router.delete('/:planId/activities/:activityId', requirePermission('evaluation_plans', 'delete'), ownPlan('planId'), controller.deleteActivity);

router.post('/:planId/close', requirePermission('evaluation_plans', 'update'), ownPlan('planId'), controller.closePlan);
router.post('/:planId/reopen', requirePermission('evaluation_plans', 'update'), ownPlan('planId'), controller.reopenPlan);

module.exports = router;
