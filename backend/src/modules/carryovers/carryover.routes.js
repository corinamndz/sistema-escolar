const router = require('express').Router();
const { z } = require('zod');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const service = require('./carryover.service');

/**
 * Materias pendientes. El acceso se valida por rol dentro del servicio:
 * Administrador, Coordinador (su nivel) y el profesor asignado a cada materia.
 */
router.use(authMiddleware, tenantMiddleware);

const uuid = z.string().uuid('Identificador inválido.');
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max, `Máximo ${max} caracteres.`).nullable().optional());

router.get('/', asyncHandler(async (req, res) => res.status(200).json(await service.list(req))));
router.get('/teachers', asyncHandler(async (req, res) => res.status(200).json(await service.listTeachers(req))));
router.post('/sync', asyncHandler(async (req, res) => res.status(200).json(await service.syncCandidates(req))));

router.put(
  '/:id/teacher',
  asyncHandler(async (req, res) => {
    const { teacherId } = z.object({ teacherId: uuid.nullable() }).parse(req.body);
    res.status(200).json(await service.assignTeacher(req, uuid.parse(req.params.id), teacherId));
  })
);

router.put(
  '/:id/plan',
  asyncHandler(async (req, res) => {
    const { moments } = z
      .object({
        moments: z
          .array(
            z.object({
              name: z.string().trim().min(1, 'Escribe el nombre del momento.').max(80, 'Máximo 80 caracteres.'),
              description: text(500),
              scheduledOn: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').nullable().optional()),
            })
          )
          .max(service.MAX_MOMENTS, `Máximo ${service.MAX_MOMENTS} momentos por materia.`),
      })
      .parse(req.body);
    res.status(200).json(await service.savePlan(req, uuid.parse(req.params.id), moments));
  })
);

router.post(
  '/moments/:momentId/grade',
  asyncHandler(async (req, res) => {
    const data = z.object({ grade: z.coerce.number().min(0, 'Entre 0 y 20.').max(20, 'Entre 0 y 20.'), notes: text(500) }).parse(req.body);
    res.status(200).json(await service.gradeMoment(req, uuid.parse(req.params.momentId), data));
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Explica el motivo (al menos 5 caracteres).').max(300, 'Máximo 300 caracteres.') }).parse(req.body);
    res.status(200).json(await service.cancel(req, uuid.parse(req.params.id), reason));
  })
);

router.post('/:id/reinstate', asyncHandler(async (req, res) => res.status(200).json(await service.reinstate(req, uuid.parse(req.params.id)))));

module.exports = router;
