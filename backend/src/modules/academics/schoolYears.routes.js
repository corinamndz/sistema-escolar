const router = require('express').Router();
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');

/**
 * GET /school-years — años escolares del colegio para el SELECTOR GLOBAL de la
 * barra superior (frontend: AcademicYearContext). Lo usa cualquier usuario del
 * personal (también docentes), sin el permiso de Académico: son solo nombres y
 * fechas, la misma información que ya muestran los selectores de cada módulo.
 *
 * → { periods: [{ id, name, start_date, end_date, is_active, closed_at }], currentId }
 *   `currentId`: el año EN CURSO (misma regla que currentPeriod() del frontend).
 */
router.get(
  '/',
  authMiddleware,
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const periods = await req.db('school_periods').where({ tenant_id: req.tenantId }).orderBy('start_date', 'desc').select('id', 'name', 'start_date', 'end_date', 'is_active', 'closed_at');
    const current = await req.db('school_periods as sp').where('sp.tenant_id', req.tenantId).orderByRaw(currentPeriodOrder('sp')).first('sp.id');
    res.status(200).json({ periods, currentId: current?.id || null });
  })
);

module.exports = router;
