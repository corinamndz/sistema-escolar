const { z } = require('zod');
const service = require('./promotion.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();

/** GET /academics/promotion/preview?fromPeriodId=&toPeriodId=&gradeId=&maxFailed= */
const preview = asyncHandler(async (req, res) => {
  const q = z
    .object({
      fromPeriodId: uuid,
      toPeriodId: uuid,
      gradeId: uuid.optional(),
      // Opcional: simula otro límite; por defecto el de la normativa del año.
      maxFailed: z.coerce.number().int().min(0).max(20).optional(),
    })
    .parse(req.query);
  res.status(200).json(await service.previewPromotion(req.db, req.tenantId, q));
});

/** POST /academics/promotion — { fromPeriodId, toPeriodId, decisions: [{ enrollmentId, action, targetSectionId?, createSectionName?, notes? }] } */
const execute = asyncHandler(async (req, res) => {
  const data = z
    .object({
      fromPeriodId: uuid,
      toPeriodId: uuid,
      decisions: z
        .array(
          z.object({
            enrollmentId: uuid,
            action: z.enum(['promote', 'retain', 'graduate']),
            targetSectionId: uuid.optional(),
            createSectionName: z.string().trim().min(1).max(20).optional(),
            notes: z.string().trim().max(300).optional(),
          })
        )
        .min(1, 'Elige al menos un alumno.')
        .max(1000),
    })
    .parse(req.body);
  res.status(200).json(await service.executePromotion(req.db, req.tenantId, req.user.id, { permissions: req.permissions }, data));
});

/** POST /academics/promotion/:enrollmentId/undo */
const undo = asyncHandler(async (req, res) => {
  res.status(200).json(await service.undoPromotion(req.db, req.tenantId, uuid.parse(req.params.enrollmentId)));
});

/** GET /academics/school-periods/:id/evaluation-rules */
const getRules = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getEvaluationRules(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** PUT /academics/school-periods/:id/evaluation-rules */
const updateRules = asyncHandler(async (req, res) => {
  const data = z
    .object({
      passingGrade: z.coerce.number().positive('Debe ser mayor que 0.').max(20, 'Máximo 20.'),
      maxFailedSubjects: z.coerce.number().int().min(0).max(20),
      termAverageMode: z.enum(['arithmetic', 'weighted']),
      gradeRounding: z.enum(['none', 'integer']),
      termWeights: z
        .array(z.object({ termId: uuid, weightPercent: z.coerce.number().min(0).max(100).nullable() }))
        .max(12)
        .optional(),
    })
    .parse(req.body);
  res.status(200).json(await service.updateEvaluationRules(req.db, req.tenantId, uuid.parse(req.params.id), data));
});

/** POST /academics/school-periods/:id/close  ·  /reopen */
const closePeriod = asyncHandler(async (req, res) => {
  res.status(200).json(await service.closeSchoolPeriod(req.db, req.tenantId, req.user.id, uuid.parse(req.params.id)));
});
const reopenPeriod = asyncHandler(async (req, res) => {
  res.status(200).json(await service.reopenSchoolPeriod(req.db, req.tenantId, uuid.parse(req.params.id)));
});

module.exports = { getRules, updateRules, preview, execute, undo, closePeriod, reopenPeriod };
