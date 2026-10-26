const router = require('express').Router();
const { z } = require('zod');
const service = require('./auditLog.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requireAdmin } = require('../../middlewares/admin.middleware');

// Bitácora de auditoría: SOLO el Administrador (rol de sistema), 403 para el resto.
router.use(authMiddleware, tenantMiddleware, requireAdmin);

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Fecha inválida.');
const listQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  module: z.string().max(40).optional(),
  userId: z.string().uuid().optional(),
  action: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});
const clean = (query) => Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v !== undefined));

router.get('/', asyncHandler(async (req, res) => res.status(200).json(await service.listLogs(req.db, req.tenantId, listQuery.parse(clean(req.query))))));
router.get('/options', asyncHandler(async (req, res) => res.status(200).json(await service.getOptions(req.db, req.tenantId))));
router.get('/:id', asyncHandler(async (req, res) => res.status(200).json(await service.getLog(req.db, req.tenantId, z.string().uuid().parse(req.params.id)))));

module.exports = router;
