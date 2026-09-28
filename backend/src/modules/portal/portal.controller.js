const { z } = require('zod');
const service = require('./portal.service');
const grades = require('./grades.service');
const { asyncHandler } = require('../../utils/asyncHandler');

/** GET /portal/me — panel del representante autenticado ({ guardian: null } si el usuario no es representante). */
const getMyPortal = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getGuardianPortal(req.db, req.tenantId, req.user.id));
});

/** GET /portal/students/:studentId/grades?schoolPeriodId= — calificaciones acumuladas de un alumno del representante. */
const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid().optional() }).parse(req.query);
  res.status(200).json(await grades.getStudentGrades(req.db, req.tenantId, req.user.id, studentId, { schoolPeriodId }));
});

module.exports = { getMyPortal, getStudentGrades };
