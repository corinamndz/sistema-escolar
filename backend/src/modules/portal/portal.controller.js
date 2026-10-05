const { z } = require('zod');
const service = require('./portal.service');
const grades = require('./grades.service');
const academicRecord = require('../academics/academicRecord.service');
const { asyncHandler } = require('../../utils/asyncHandler');

/** GET /portal/me — panel del representante autenticado ({ guardian: null } si el usuario no es representante). */
const getMyPortal = asyncHandler(async (req, res) => {
  const currency = typeof req.query.currency === 'string' && /^[A-Za-z]{3}$/.test(req.query.currency) ? req.query.currency : undefined;
  res.status(200).json(await service.getGuardianPortal(req.db, req.tenantId, req.user.id, { currency }));
});

/** GET /portal/students/:studentId/history — historial académico de un alumno del representante. */
const getStudentHistory = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await academicRecord.getStudentHistory(req.db, req.tenantId, studentId));
});

/** GET /portal/students/:studentId/grades?schoolPeriodId= — calificaciones acumuladas de un alumno del representante. */
const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid().optional() }).parse(req.query);
  res.status(200).json(await grades.getStudentGrades(req.db, req.tenantId, req.user.id, studentId, { schoolPeriodId }));
});

module.exports = {
  getStudentHistory, getMyPortal, getStudentGrades };
