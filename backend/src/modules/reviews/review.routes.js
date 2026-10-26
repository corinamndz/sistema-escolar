const router = require('express').Router();
const { z } = require('zod');
const service = require('./review.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');

/**
 * Revisión de Planes de evaluación y Contenido programático (migración 058).
 * Todo exige acceso al módulo de planes; quién envía, revisa o comenta (y el
 * filtro por nivel del coordinador) lo decide review.service.
 *
 *   GET  /reviews/inbox                                  pendientes del revisor
 *   GET  /reviews/plans/:planId                          estado + hilo
 *   POST /reviews/plans/:planId/submit      { comment? } enviar / reenviar
 *   POST /reviews/plans/:planId/review      { decision: 'approve' | 'observe', comment? }
 *   POST /reviews/plans/:planId/comments    { body }
 *   … y lo mismo en /reviews/contents/:gradeId/:subjectId (el programa de una materia en un grado).
 */
router.use(authMiddleware, tenantMiddleware, requirePermission('evaluation_plans', 'read'));

const uuid = z.string().uuid();
const text = z.string().trim().max(4000, 'Máximo 4000 caracteres.');
const submitBody = z.object({ comment: text.optional() });
const reviewBody = z.object({ decision: z.enum(['approve', 'observe']), comment: text.optional() });
const commentBody = z.object({ body: text.min(1, 'Escribe el comentario.') });

const targets = {
  plans: { type: 'plan', path: '/plans/:planId', key: (p) => ({ planId: uuid.parse(p.planId) }) },
  contents: { type: 'content', path: '/contents/:gradeId/:subjectId', key: (p) => ({ gradeId: uuid.parse(p.gradeId), subjectId: uuid.parse(p.subjectId) }) },
};

router.get('/inbox', asyncHandler(async (req, res) => res.status(200).json(await service.inbox(req))));

for (const t of Object.values(targets)) {
  router.get(t.path, asyncHandler(async (req, res) => res.status(200).json(await service.getReview(req, t.type, t.key(req.params)))));
  router.post(`${t.path}/submit`, asyncHandler(async (req, res) => res.status(200).json(await service.submit(req, t.type, t.key(req.params), submitBody.parse(req.body || {})))));
  router.post(`${t.path}/review`, asyncHandler(async (req, res) => res.status(200).json(await service.review(req, t.type, t.key(req.params), reviewBody.parse(req.body)))));
  router.post(`${t.path}/comments`, asyncHandler(async (req, res) => res.status(201).json(await service.comment(req, t.type, t.key(req.params), commentBody.parse(req.body)))));
}

module.exports = router;
