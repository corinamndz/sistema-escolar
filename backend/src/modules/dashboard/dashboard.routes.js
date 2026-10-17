const router = require('express').Router();
const service = require('./dashboard.service');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requirePermission } = require('../../middlewares/permission.middleware');
const scope = require('../access/teacherScope');
const { asyncHandler } = require('../../utils/asyncHandler');

// Cifras de todo el colegio: administración y directiva (el docente con carga restringida → 403).
router.use(authMiddleware, tenantMiddleware, scope.denyTeachers);

/** GET /dashboard/summary — KPIs y datos de los gráficos del inicio, según los módulos que el usuario puede leer. */
router.get(
  '/summary',
  requirePermission('dashboard', 'read'),
  asyncHandler(async (req, res) => {
    res.status(200).json(await service.getSummary(req.db, req.tenantId, req.permissions));
  })
);

module.exports = router;
