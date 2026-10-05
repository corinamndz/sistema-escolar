const { z } = require('zod');
const service = require('./grading.service');
const { asyncHandler } = require('../../utils/asyncHandler');

/**
 * Actividad simple: { studentId, rawScore, maxScore? } (maxScore por defecto el de la actividad).
 * Actividad con indicadores (formato detallado): { studentId, indicatorScores: [{ indicatorId, points }] }
 * con TODOS sus indicadores; la nota es la suma.
 */
const scoreSchema = z
  .object({
    studentId: z.string().uuid(),
    rawScore: z.number().min(0).optional(),
    maxScore: z.number().positive().optional(),
    indicatorScores: z
      .array(
        z.object({
          indicatorId: z.string().uuid(),
          points: z
            .number()
            .min(0, 'La nota no puede ser negativa.')
            .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Usa como máximo 2 decimales.'),
        })
      )
      .max(100)
      .optional(),
  })
  .refine((b) => b.rawScore !== undefined || b.indicatorScores, { message: 'Envía la nota (rawScore) o las notas por indicador.' });

const upsertScore = asyncHandler(async (req, res) => {
  const data = scoreSchema.parse(req.body);
  const score = await service.upsertScore(req.db, req.tenantId, { activityId: req.params.activityId, ...data });
  res.status(200).json(score);
});

const getGradebook = asyncHandler(async (req, res) => {
  const sectionId = z.string().uuid().optional().parse(req.query.sectionId || undefined);
  const gradebook = await service.getPlanGradebook(req.db, req.tenantId, req.params.planId, { sectionId });
  res.status(200).json(gradebook);
});

const competencySchema = z.object({
  studentId: z.string().uuid(),
  result: z.enum(['achieved', 'needs_improvement']),
});

const assessCompetency = asyncHandler(async (req, res) => {
  const data = competencySchema.parse(req.body);
  const assessment = await service.upsertCompetencyAssessment(req.db, req.tenantId, {
    competencyId: req.params.competencyId,
    ...data,
  });
  res.status(200).json(assessment);
});

const getCompetencyReport = asyncHandler(async (req, res) => {
  const report = await service.getCompetencyReport(req.db, req.tenantId, req.params.projectId);
  res.status(200).json(report);
});

module.exports = { upsertScore, getGradebook, assessCompetency, getCompetencyReport };
