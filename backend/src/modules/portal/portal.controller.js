const { z } = require('zod');
const service = require('./portal.service');
const grades = require('./grades.service');
const academicRecord = require('../academics/academicRecord.service');
const schedules = require('../schedules/schedule.service');
const discipline = require('../discipline/discipline.service');
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
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  res.status(200).json(await academicRecord.getStudentHistory(req.db, req.tenantId, studentId));
});

/** Horario (solo lectura) de la sección en que cursa un alumno del representante. */
const getStudentSchedule = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await schedules.getStudentSchedule(req.db, req.tenantId, studentId));
});

/**
 * GET /portal/students/:studentId/sanctions — historial disciplinario de un
 * alumno del representante. Solo de los alumnos vinculados a su cuenta (404 si no).
 */
const getStudentSanctions = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await discipline.getStudentSanctionsForGuardian(req.db, req.tenantId, studentId));
});

/** GET /portal/students/:studentId/grades?schoolPeriodId= — calificaciones acumuladas de un alumno del representante. */
const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid().optional() }).parse(req.query);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  res.status(200).json(await grades.getStudentGrades(req.db, req.tenantId, req.user.id, studentId, { schoolPeriodId }));
});

module.exports = {
  getStudentHistory, getStudentSchedule, getStudentSanctions, getMyPortal, getStudentGrades };
