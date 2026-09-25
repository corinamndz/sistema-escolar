const { z } = require('zod');
const service = require('./grading.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const scoreSchema = z.object({
  studentId: z.string().uuid(),
  rawScore: z.number().min(0),
  maxScore: z.number().positive().default(20),
});

const upsertScore = asyncHandler(async (req, res) => {
  const data = scoreSchema.parse(req.body);
  const score = await service.upsertScore(req.db, req.tenantId, { activityId: req.params.activityId, ...data });
  res.status(200).json(score);
});

const getGradebook = asyncHandler(async (req, res) => {
  const gradebook = await service.getPlanGradebook(req.db, req.tenantId, req.params.planId);
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
