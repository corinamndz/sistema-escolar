const { z } = require('zod');
const { MAX_TERMS } = require('../academics/evaluationPeriods.service');
const service = require('./portal.service');
const grades = require('./grades.service');
const academicRecord = require('../academics/academicRecord.service');
const schedules = require('../schedules/schedule.service');
const evaluationCalendar = require('../schedules/evaluationCalendar.service');
const clubs = require('../clubs/club.service');
const discipline = require('../discipline/discipline.service');
const recognitions = require('../recognitions/recognition.service');
const acknowledgments = require('./planAcknowledgment.service');
const audit = require('../../services/audit/audit.service');
const certificates = require('../certificates/certificate.service');
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
  const history = await academicRecord.getStudentHistory(req.db, req.tenantId, studentId);
  res.status(200).json({ ...history, certificate_enrollment_ids: await certificates.publishedEnrollmentIds(req.db, req.tenantId, studentId) });
});

/**
 * GET /portal/certificates — certificados de promoción de TODOS los alumnos del
 * representante, agrupados por alumno, de todos sus años:
 *   [{ student: { id, name, status }, current, certificates: [...], unpublished: [años], locked: mensaje | null }]
 * Con las mismas reglas que el certificado de cada alumno: con cuotas vencidas
 * ese alumno sale bloqueado (sin certificados) y los demás se muestran igual.
 */
const getMyCertificates = asyncHandler(async (req, res) => {
  const students = await req.db('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .join('students as s', 's.id', 'sg.student_id')
    .where({ 'g.tenant_id': req.tenantId, 'g.user_id': req.user.id })
    .distinct('s.id', 's.first_name', 's.last_name', 's.status')
    .orderBy(['s.first_name', 's.last_name']);
  const out = [];
  for (const s of students) {
    const item = { student: { id: s.id, name: `${s.first_name} ${s.last_name}`, status: s.status }, current: null, certificates: [], unpublished: [], locked: null };
    try {
      await grades.assertGradesUnlocked(req.db, req.tenantId, s.id);
    } catch (err) {
      if (err.statusCode !== 403) throw err;
      out.push({ ...item, locked: err.message });
      continue;
    }
    out.push({ ...item, ...(await certificates.studentCertificates(req.db, req.tenantId, s.id)) });
  }
  res.status(200).json(out);
});

/** GET /portal/students/:studentId/certificate?enrollmentId= — certificado de promoción de un alumno del representante. */
const getStudentCertificate = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const enrollmentId = req.query.enrollmentId ? z.string().uuid().parse(req.query.enrollmentId) : null;
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  // Con el diseño del año y el nivel de esa matrícula; 404 si ese diseño no está publicado.
  const { buffer, fileName } = await certificates.studentPdf(req.db, req.tenantId, studentId, { enrollmentId, requirePublished: true });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
  res.status(200).send(buffer);
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

/** GET /portal/students/:studentId/recognitions — reconocimientos de un alumno del representante (404 si no es suyo). */
const getStudentRecognitions = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId);
  res.status(200).json(await recognitions.getStudentRecognitionsForGuardian(req.db, req.tenantId, studentId));
});

/** GET /portal/students/:studentId/recognitions/:id/certificate — certificado en PDF (solo de sus representados). */
const getRecognitionCertificate = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId);
  const { buffer, filename } = await recognitions.certificatePdf(req.db, req.tenantId, z.string().uuid().parse(req.params.id), { studentId });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  res.send(buffer);
});

/** GET /portal/students/:studentId/grades?schoolPeriodId= — calificaciones acumuladas de un alumno del representante. */
/** GET /portal/students/:studentId/carryovers — materias pendientes (mismas reglas que las calificaciones). */
const getStudentCarryovers = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  res.status(200).json(await require('../carryovers/carryover.service').listForStudent(req.db, req.tenantId, studentId));
});

const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid().optional() }).parse(req.query);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  res.status(200).json(await grades.getStudentGrades(req.db, req.tenantId, req.user.id, studentId, { schoolPeriodId }));
});

/** GET /portal/students/:studentId/evaluation-plans/:planId — plan de evaluación completo (solo lectura). */
const getStudentPlanDetail = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const planId = z.string().uuid().parse(req.params.planId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  const detail = await grades.getStudentPlanDetail(req.db, req.tenantId, studentId, planId);
  // Constancia de lectura (069): ¿este representante ya confirmó esta versión del plan?
  res.status(200).json({ ...detail, acknowledgment: await acknowledgments.stateFor(req.db, req.tenantId, req.user.id, studentId, detail) });
});

/**
 * POST /portal/students/:studentId/evaluation-plans/:planId/acknowledge — "He leído y acepto
 * el plan de evaluación": guarda la constancia (fecha, IP, navegador y la versión vista).
 */
const acknowledgePlan = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const planId = z.string().uuid().parse(req.params.planId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  await grades.assertGradesUnlocked(req.db, req.tenantId, studentId); // 403 si tiene cuotas vencidas
  res.status(201).json(await acknowledgments.acknowledge(req.db, req.tenantId, req.user.id, studentId, planId, audit.requestContext(req)));
});

/**
 * GET /portal/students/:studentId/subjects/:subjectId/program?schoolPeriodId= —
 * contenido programático de la materia con las evaluaciones (publicadas) de la
 * sección del alumno. SOLO de sus representados (404 si no).
 */
const getStudentSubjectProgram = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const subjectId = z.string().uuid().parse(req.params.subjectId);
  const { schoolPeriodId } = z.object({ schoolPeriodId: z.string().uuid().optional() }).parse(req.query);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await grades.getStudentSubjectProgram(req.db, req.tenantId, studentId, subjectId, { schoolPeriodId }));
});

/**
 * GET /portal/students/:studentId/evaluations?term_number= — cronograma de
 * evaluaciones de la sección del alumno. SOLO de los alumnos vinculados a la
 * cuenta del representante (404 si no es su representado).
 */
const getStudentEvaluations = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const { termNumber } = z
    .object({ termNumber: z.coerce.number().int().min(1).max(MAX_TERMS).optional() })
    .parse({ termNumber: req.query.term_number ?? req.query.termNumber ?? undefined });
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await evaluationCalendar.getStudentEvaluationCalendar(req.db, req.tenantId, studentId, { termNumber }));
});

/**
 * GET /portal/students/:studentId/clubs — clubes y actividades del alumno
 * (todos los años). SOLO de los alumnos vinculados al representante (404 si no).
 */
const getStudentClubs = asyncHandler(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  await grades.assertGuardianOfStudent(req.db, req.tenantId, req.user.id, studentId); // 404 si no es suyo
  res.status(200).json(await clubs.studentClubs(req.db, req.tenantId, studentId));
});

module.exports = {
  getStudentCertificate,
  getStudentCarryovers,
  acknowledgePlan,
  getStudentRecognitions,
  getRecognitionCertificate,
  getStudentClubs,
  getStudentEvaluations,
  getStudentPlanDetail,
  getStudentSubjectProgram,
  getStudentHistory, getMyCertificates, getStudentSchedule, getStudentSanctions, getMyPortal, getStudentGrades };
