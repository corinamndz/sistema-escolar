const router = require('express').Router();
const controller = require('./grading.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

router.use(authMiddleware, tenantMiddleware);

router.get('/plans/:planId/gradebook', requirePermission('grading', 'read'), controller.getGradebook);
router.put('/activities/:activityId/scores', requirePermission('grading', 'update'), controller.upsertScore);

router.put('/competencies/:competencyId/assessments', requirePermission('grading', 'update'), controller.assessCompetency);
router.get('/projects/:projectId/competency-report', requirePermission('grading', 'read'), controller.getCompetencyReport);

module.exports = router;
