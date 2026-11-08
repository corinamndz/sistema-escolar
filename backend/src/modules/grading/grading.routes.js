const router = require('express').Router();
const controller = require('./grading.controller');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');
const { z } = require('zod');
const summary = require('./gradeSummary.service');
const adjustments = require('./gradeAdjustments.service');
const coordinatorScope = require('../access/coordinatorScope');
const { isAdmin, requireAdmin } = require('../../middlewares/admin.middleware');
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

// Resumen de calificaciones: quien tiene Calificaciones (no docente) o el Coordinador, SOLO con
// los alumnos de su nivel (req.summaryLevel). Ajustar la definitiva: Administrador o Coordinador del nivel.
async function summaryAccess(req, res, next) {
  try {
    const coord = await coordinatorScope.getCoordinatorScope(req);
    if (coord) {
      coordinatorScope.assertHasLevel(coord);
      req.summaryLevel = coord.level;
      return next();
    }
    req.summaryLevel = null;
    return requirePermission('grading', 'read')(req, res, (err) => (err ? next(err) : scope.denyTeachers(req, res, next)));
  } catch (err) {
    return next(err);
  }
}

// Resumen de calificaciones del colegio (Administración): acumulado por lapso de cada alumno.
router.get(
  '/summary',
  summaryAccess,
  asyncHandler(async (req, res) => {
    const schoolPeriodId = z.string().uuid().optional().parse(req.query.schoolPeriodId || undefined);
    const data = await summary.getSummary(req.db, req.tenantId, { schoolPeriodId, levelCode: req.summaryLevel });
    res.status(200).json({ ...data, can_adjust: Boolean(await adjustments.adjusterRole(req)), can_close_terms: await isAdmin(req.db, req.tenantId, req.user.id) });
  })
);
/**
 * GET /grading/summary/students/:studentId?schoolPeriodId= — desglose de UN alumno:
 * notas por materia y lapso, definitiva y estado (aprobada / reprobada) según la escala del año,
 * con el historial de ajustes directivos y si el usuario puede ajustar (can_adjust).
 */
router.get(
  '/summary/students/:studentId',
  summaryAccess,
  asyncHandler(async (req, res) => {
    const studentId = z.string().uuid('Alumno inválido.').parse(req.params.studentId);
    const schoolPeriodId = z.string().uuid().optional().parse(req.query.schoolPeriodId || undefined);
    const detail = await summary.getStudentDetail(req.db, req.tenantId, studentId, { schoolPeriodId, levelCode: req.summaryLevel });
    const canAdjust = Boolean(detail.student && (await adjustments.adjusterRole(req, detail.student.level_code)));
    res.status(200).json({ ...detail, can_adjust: canAdjust });
  })
);
/**
 * POST /grading/summary/students/:studentId/adjustments — ajuste directivo de la definitiva
 * de una materia en un lapso cerrado. Motivo OBLIGATORIO (mín. 10 caracteres); queda en
 * grade_audit_logs y en la bitácora de auditoría. newGrade null = quitar el ajuste.
 *   { schoolPeriodId, termId, subjectKey, newGrade, reason } → detalle actualizado
 */
router.post(
  '/summary/students/:studentId/adjustments',
  summaryAccess,
  asyncHandler(async (req, res) => {
    const studentId = z.string().uuid('Alumno inválido.').parse(req.params.studentId);
    const data = z
      .object({
        schoolPeriodId: z.string().uuid('Año escolar inválido.'),
        termId: z.string().uuid('Lapso inválido.'),
        subjectKey: z.string().trim().min(1, 'Materia inválida.').max(200),
        newGrade: z.number({ invalid_type_error: 'Escribe la nota nueva.' }).min(0, 'Mínimo 0.').max(20, 'Máximo 20.').nullable(),
        reason: z.string({ required_error: 'El motivo es obligatorio.' }).trim().min(adjustments.MIN_REASON, `Explica el motivo del ajuste (al menos ${adjustments.MIN_REASON} caracteres).`).max(500, 'Máximo 500 caracteres.'),
      })
      .parse(req.body);
    const detail = await adjustments.adjust(req, studentId, data);
    res.status(201).json({ ...detail, can_adjust: true });
  })
);

// Cerrar o reabrir un lapso de todo el colegio: solo el Administrador.
router.post(
  '/summary/terms/:termId/close',
  requireAdmin,
  asyncHandler(async (req, res) => res.status(200).json(await adjustments.setTermClosed(req, z.string().uuid('Lapso inválido.').parse(req.params.termId), true)))
);
router.post(
  '/summary/terms/:termId/reopen',
  requireAdmin,
  asyncHandler(async (req, res) => res.status(200).json(await adjustments.setTermClosed(req, z.string().uuid('Lapso inválido.').parse(req.params.termId), false)))
);

module.exports = router;
