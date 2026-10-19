const router = require('express').Router();
const controller = require('./grading.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');
const { z } = require('zod');
const summary = require('./gradeSummary.service');
const { asyncHandler } = require('../../utils/asyncHandler');

// Docente: solo planes, actividades y proyectos de su carga (los demás → 404).

router.use(authMiddleware, tenantMiddleware);

router.get('/plans/:planId/gradebook', requirePermission('grading', 'read'), scope.guardParam(scope.assertPlanAccess, 'planId'), controller.getGradebook);
router.put('/activities/:activityId/scores', requirePermission('grading', 'update'), scope.guardParam(scope.assertActivityAccess, 'activityId'), controller.upsertScore);

router.put(
  '/competencies/:competencyId/assessments',
  requirePermission('grading', 'update'),
  scope.guardParam(scope.assertCompetencyAccess, 'competencyId'),
  controller.assessCompetency
);
router.get('/projects/:projectId/competency-report', requirePermission('grading', 'read'), scope.guardParam(scope.assertProjectAccess, 'projectId'), controller.getCompetencyReport);

// Resumen de calificaciones del colegio (Administración): acumulado por lapso de cada alumno.
router.get(
  '/summary',
  requirePermission('grading', 'read'),
  scope.denyTeachers,
  asyncHandler(async (req, res) => {
    const schoolPeriodId = z.string().uuid().optional().parse(req.query.schoolPeriodId || undefined);
    res.status(200).json(await summary.getSummary(req.db, req.tenantId, { schoolPeriodId }));
  })
);

module.exports = router;
