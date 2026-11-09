const router = require('express').Router();
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');
const { z } = require('zod');
const { ApiError } = require('../../utils/ApiError');
const { isAdmin } = require('../../middlewares/admin.middleware');
const coordinatorScope = require('../access/coordinatorScope');
const periods = require('./evaluationPeriods.service');

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

const uuid = z.string().uuid('Año escolar inválido.');

/**
 * GET /school-years/:id/terms — períodos de evaluación del año, para los selectores
 * y los títulos de cualquier módulo (también el portal): solo nombres y fechas.
 */
router.get(
  '/:id/terms',
  authMiddleware,
  tenantMiddleware,
  asyncHandler(async (req, res) => {
    const rows = await req
      .db('terms')
      .where({ tenant_id: req.tenantId, school_period_id: uuid.parse(req.params.id) })
      .orderByRaw('term_number NULLS LAST, start_date NULLS LAST, name')
      .select('id', 'name', 'term_number', 'start_date', 'end_date', 'closed_at');
    res.status(200).json(rows);
  })
);

/** Configurar períodos: el Administrador o el Coordinador. Aplica a todos los niveles del colegio. */
async function requirePeriodManager(req, res, next) {
  try {
    if (await isAdmin(req.db, req.tenantId, req.user.id)) return next();
    const coord = await coordinatorScope.getCoordinatorScope(req);
    if (coord) {
      coordinatorScope.assertHasLevel(coord);
      return next();
    }
    throw ApiError.forbidden('Solo el Administrador o el Coordinador pueden configurar los períodos de evaluación.');
  } catch (err) {
    return next(err);
  }
}

/** GET /school-years/:id/evaluation-periods — configuración del año, con lo que depende de cada período. */
router.get(
  '/:id/evaluation-periods',
  authMiddleware,
  tenantMiddleware,
  requirePeriodManager,
  asyncHandler(async (req, res) => res.status(200).json(await periods.getConfig(req.db, req.tenantId, uuid.parse(req.params.id))))
);

/**
 * PUT /school-years/:id/evaluation-periods — guarda la lista completa, en su orden:
 *   { terms: [{ id?, name, startDate, endDate }] } → { terms, warnings }
 */
router.put(
  '/:id/evaluation-periods',
  authMiddleware,
  tenantMiddleware,
  requirePeriodManager,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        terms: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              name: z.string({ required_error: 'Escribe el nombre.' }).trim().max(60, 'Máximo 60 caracteres.'),
              startDate: z.string().optional().nullable(),
              endDate: z.string().optional().nullable(),
            })
          )
          .max(periods.MAX_TERMS, `Máximo ${periods.MAX_TERMS} períodos por año.`),
      })
      .parse(req.body);
    res.status(200).json(await periods.saveConfig(req.db, req.tenantId, req.user.id, uuid.parse(req.params.id), data));
  })
);

module.exports = router;
