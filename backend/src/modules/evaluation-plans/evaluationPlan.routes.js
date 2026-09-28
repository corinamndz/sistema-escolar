const router = require('express').Router();
const controller = require('./evaluationPlan.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

router.get('/terms', requirePermission('evaluation_plans', 'read'), controller.listTerms);
router.post('/terms', requirePermission('evaluation_plans', 'create'), controller.createTerm);

router.get('/', requirePermission('evaluation_plans', 'read'), controller.listPlans);
router.post('/', requirePermission('evaluation_plans', 'create'), controller.createPlan);
router.get('/:id', requirePermission('evaluation_plans', 'read'), controller.getPlan);

router.post('/:planId/project', requirePermission('evaluation_plans', 'create'), controller.createProject);
router.post('/projects/:projectId/competencies', requirePermission('evaluation_plans', 'update'), controller.addCompetency);

router.post('/:planId/activities', requirePermission('evaluation_plans', 'create'), controller.createActivity);
router.put('/:planId/activities/:activityId', requirePermission('evaluation_plans', 'update'), controller.updateActivity);
router.delete('/:planId/activities/:activityId', requirePermission('evaluation_plans', 'delete'), controller.deleteActivity);

router.post('/:planId/close', requirePermission('evaluation_plans', 'update'), controller.closePlan);
router.post('/:planId/reopen', requirePermission('evaluation_plans', 'update'), controller.reopenPlan);

module.exports = router;
