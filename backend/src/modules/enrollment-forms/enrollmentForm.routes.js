const router = require('express').Router();
const { z } = require('zod');
const service = require('./enrollmentForm.service');
const { TEMPLATE_STYLES } = require('../../services/pdf/enrollmentFormGenerator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { tenantMiddleware } = require('../../middlewares/tenant.middleware');
const { requireAdmissions } = require('../../middlewares/admin.middleware');
const approval = require('./enrollmentApproval.service');
const { ApiError } = require('../../utils/ApiError');
const { enrollmentPhotoUpload } = require('../../middlewares/upload.middleware');
const { savePhoto, removePhoto } = require('../../services/storage/enrollmentPhotoStorage');

/**
 * Planillas de inscripción (migración 078).
 *   Administración (rol Administrador o Admisiones, migración 083): diseñar, publicar, revisar y aprobar (alta automática).
 *   Portal del representante: ver las planillas publicadas y enviarlas.
 */
router.use(authMiddleware, tenantMiddleware);

const uuid = z.string().uuid('Identificador inválido.');
const idParam = (req) => uuid.parse(req.params.id);
// Diseño, bandeja y aprobación: exclusivos de los roles Administrador y Admisiones (requireAdmissions), no basta el permiso de módulo.

// ---- Portal del representante (rutas fijas antes de "/:id") ----
/** GET /enrollment-forms/portal/reminders — inscripciones pendientes (aviso del inicio del portal). */
router.get('/portal/reminders', asyncHandler(async (req, res) => res.status(200).json(await service.portalReminders(req.db, req.tenantId, req.user.id))));
router.get('/portal', asyncHandler(async (req, res) => res.status(200).json(await service.portalOverview(req.db, req.tenantId, req.user.id))));
/** POST /enrollment-forms/portal/:id/submit — { studentId? | applicantName?, submissionId?, answers } */
router.post(
  '/portal/:id/submit',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        studentId: uuid.nullable().optional(),
        applicantName: z.string().trim().max(150, 'Máximo 150 caracteres.').nullable().optional(),
        submissionId: uuid.nullable().optional(),
        answers: z.record(z.any()).default({}),
      })
      .parse(req.body);
    res.status(200).json(await service.submit(req.db, req.tenantId, req.user.id, idParam(req), data));
  })
);

/**
 * GET /enrollment-forms/portal/:id/prefill?studentId= — respuestas precargadas
 * para re-inscribir a un alumno ya registrado → { answers, sources, previous }.
 */
router.get(
  '/portal/:id/prefill',
  asyncHandler(async (req, res) => {
    const studentId = uuid.parse(req.query.studentId);
    res.status(200).json(await service.prefill(req.db, req.tenantId, req.user.id, idParam(req), studentId));
  })
);
/**
 * DELETE /enrollment-forms/portal/submissions/:id — el representante elimina su
 * planilla mientras está en revisión o por corregir (para enviar una nueva).
 */
router.delete(
  '/portal/submissions/:id',
  asyncHandler(async (req, res) => {
    const { photos } = await service.deleteOwnSubmission(req.db, req.tenantId, req.user.id, idParam(req));
    // Las fotos que quedaron sin uso se borran del disco solo si el cambio se confirmó.
    res.once('finish', () => {
      if (res.statusCode === 204) photos.forEach((file) => removePhoto(req.tenantId, file));
    });
    res.status(204).send();
  })
);

// ---- «Ver como representante» (Administrador o Admisiones, SOLO LECTURA) ----
// La misma información y validaciones que el portal del representante, sin su sesión ni cambios:
// el administrador comprueba qué ve la familia (planilla «Por llenar» del año nuevo, precarga, avisos).
const asGuardian = (req) => ({ guardianId: uuid.parse(req.params.guardianId) });

/** GET /enrollment-forms/preview/guardians/:guardianId — el portal de Inscripción tal como lo ve ese representante. */
router.get(
  '/preview/guardians/:guardianId',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const who = asGuardian(req);
    const guardian = await req.db('guardians').where({ tenant_id: req.tenantId, id: who.guardianId }).first('id', 'first_name', 'last_name', 'email', 'user_id');
    if (!guardian) throw ApiError.notFound('Representante no encontrado.');
    const overview = await service.portalOverview(req.db, req.tenantId, who);
    res.status(200).json({
      guardian: { id: guardian.id, name: `${guardian.first_name} ${guardian.last_name}`, email: guardian.email, hasAccount: Boolean(guardian.user_id) },
      ...overview,
    });
  })
);
/** GET /enrollment-forms/preview/guardians/:guardianId/forms/:id/prefill?studentId= — la precarga que vería. */
router.get(
  '/preview/guardians/:guardianId/forms/:id/prefill',
  requireAdmissions,
  asyncHandler(async (req, res) => res.status(200).json(await service.prefill(req.db, req.tenantId, asGuardian(req), idParam(req), uuid.parse(req.query.studentId))))
);
/**
 * POST /enrollment-forms/preview/guardians/:guardianId/forms/:id/check — «Probar envío»:
 * las mismas validaciones del envío real, SIN guardar (dryRun).
 */
router.post(
  '/preview/guardians/:guardianId/forms/:id/check',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        studentId: uuid.nullable().optional(),
        applicantName: z.string().trim().max(150, 'Máximo 150 caracteres.').nullable().optional(),
        submissionId: uuid.nullable().optional(),
        answers: z.record(z.any()).default({}),
      })
      .parse(req.body);
    res.status(200).json(await service.submit(req.db, req.tenantId, asGuardian(req), idParam(req), data, { dryRun: true }));
  })
);

/** PDF de una planilla propia (membrete del colegio y firmas). */
const sendPdf = (res, { buffer, fileName }) => {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${fileName}"`, 'Cache-Control': 'private, no-store' });
  res.status(200).send(buffer);
};
router.get(
  '/portal/submissions/:id/pdf',
  asyncHandler(async (req, res) => sendPdf(res, await service.submissionPdf(req.db, req.tenantId, idParam(req), { guardianUserId: req.user.id })))
);

// ---- Foto del alumno (privada: fotos de menores, nunca como archivo público) ----
const photoName = (req) => z.string().regex(/^[0-9a-f-]{36}\.(jpg|png)$/, 'Foto inválida.').parse(req.params.file);
const sendPhoto = (res, full) => {
  res.set({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(full);
};
/** POST /enrollment-forms/portal/photos (multipart, campo `photo`) → { file } para la respuesta del campo foto. */
router.post(
  '/portal/photos',
  enrollmentPhotoUpload,
  asyncHandler(async (req, res) => {
    const g = await req.db('guardians').where({ tenant_id: req.tenantId, user_id: req.user.id }).first('id');
    if (!g) throw ApiError.forbidden('Esta sección es para representantes.');
    if (!req.file) throw ApiError.badRequest('Elige una foto.', [{ path: 'photo', message: 'Requerido.' }]);
    res.status(201).json({ file: await savePhoto(req.tenantId, req.file.buffer) });
  })
);
router.get('/portal/photos/:file', asyncHandler(async (req, res) => sendPhoto(res, await service.photoFor(req.db, req.tenantId, photoName(req), { guardianUserId: req.user.id }))));

// ---- Administración ----
router.get('/photos/:file', requireAdmissions, asyncHandler(async (req, res) => sendPhoto(res, await service.photoFor(req.db, req.tenantId, photoName(req)))));
router.get('/submissions/:id/pdf', requireAdmissions, asyncHandler(async (req, res) => sendPdf(res, await service.submissionPdf(req.db, req.tenantId, idParam(req)))));
const fieldsSchema = z.array(z.record(z.any())).max(80, 'Máximo 80 campos por planilla.');
router.get('/', requireAdmissions, asyncHandler(async (req, res) => res.status(200).json(await service.listForms(req.db, req.tenantId))));
// Años escolares abiertos (para crear planillas sin depender del permiso de Académico).
router.get(
  '/periods',
  requireAdmissions,
  asyncHandler(async (req, res) =>
    res.status(200).json(await req.db('school_periods').where({ tenant_id: req.tenantId }).whereNull('closed_at').orderBy('start_date', 'desc').select('id', 'name', 'start_date', 'end_date', 'is_active', 'closed_at'))
  )
);
router.post(
  '/',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        schoolPeriodId: uuid,
        title: z.string().trim().min(3, 'Escribe el título (mínimo 3 caracteres).').max(150),
        description: z.string().trim().max(1000).nullable().optional(),
        copyFromId: uuid.nullable().optional(),
      })
      .parse(req.body);
    res.status(201).json(await service.createForm(req.db, req.tenantId, req.user.id, data));
  })
);
/** GET /enrollment-forms/students/:studentId/history — planillas del alumno a lo largo de los años. */
router.get(
  '/students/:studentId/history',
  requireAdmissions,
  asyncHandler(async (req, res) => res.status(200).json(await approval.studentHistory(req.db, req.tenantId, uuid.parse(req.params.studentId))))
);
/** GET /enrollment-forms/submissions?status=&formId=&kind=new|renewal&q= — bandeja de planillas recibidas. */
router.get(
  '/submissions',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const f = z
      .object({
        status: z.enum(['pending', 'submitted', 'changes_requested', 'approved', 'rejected']).optional(),
        formId: uuid.optional(),
        schoolPeriodId: uuid.optional(),
        kind: z.enum(['new', 'renewal']).optional(),
        q: z.string().trim().max(100).optional(),
      })
      .parse(req.query);
    res.status(200).json(await service.inbox(req.db, req.tenantId, { status: f.status, formId: f.formId, kind: f.kind, q: f.q || null, schoolPeriodId: f.schoolPeriodId || null }));
  })
);
/** GET /enrollment-forms/submissions/:id/approval — propuesta de alta (alumno, sección, representantes). */
router.get('/submissions/:id/approval', requireAdmissions, asyncHandler(async (req, res) => res.status(200).json(await approval.approvalDraft(req.db, req.tenantId, idParam(req)))));
/**
 * POST /enrollment-forms/submissions/:id/approve — aprueba e inscribe en una
 * sola transacción (la de la petición): crea/actualiza el alumno, crea o asocia
 * al representante legal (principal), vincula a quien envió y lo matricula.
 */
router.post(
  '/submissions/:id/approve',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const txt = (max, msg) => z.string().trim().max(max, msg);
    const data = z
      .object({
        student: z.object({
          existingId: uuid.nullable().optional(),
          firstName: txt(100, 'Máximo 100 caracteres.').min(1, 'Escribe los nombres del alumno.'),
          lastName: txt(100, 'Máximo 100 caracteres.').min(1, 'Escribe los apellidos del alumno.'),
          nationalId: txt(30, 'Máximo 30 caracteres.').nullable().optional(),
          birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida.').nullable().optional().or(z.literal('')),
        }),
        sectionId: uuid.nullable().optional(),
        legal: z.object({
          guardianId: uuid.nullable().optional(),
          firstName: txt(100, 'Máximo 100 caracteres.').optional().default(''),
          lastName: txt(100, 'Máximo 100 caracteres.').optional().default(''),
          nationalId: txt(30, 'Máximo 30 caracteres.').nullable().optional(),
          phone: txt(30, 'Máximo 30 caracteres.').nullable().optional(),
          email: z.string().trim().email('Correo inválido.').max(150).nullable().optional().or(z.literal('')),
          relationship: z.enum(approval.RELATIONSHIPS, { errorMap: () => ({ message: 'Elige el parentesco.' }) }),
        }),
        submitterRelationship: z.enum(approval.RELATIONSHIPS).nullable().optional(),
        note: z.string().trim().max(500, 'Máximo 500 caracteres.').nullable().optional(),
      })
      .parse(req.body);
    res.status(200).json(await approval.approveSubmission(req.db, req.tenantId, req.user.id, idParam(req), data));
  })
);
router.get('/submissions/:id', requireAdmissions, asyncHandler(async (req, res) => res.status(200).json(await service.getSubmission(req.db, req.tenantId, idParam(req)))));
/** POST /enrollment-forms/submissions/:id/review — { status: approved|rejected|changes_requested, note? } */
router.post(
  '/submissions/:id/review',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        // Aprobar va por /approve (da de alta al alumno y lo inscribe).
        status: z.enum(['rejected', 'changes_requested'], { errorMap: () => ({ message: 'Decisión inválida.' }) }),
        note: z.string().trim().max(500, 'Máximo 500 caracteres.').nullable().optional(),
      })
      .parse(req.body);
    res.status(200).json(await service.reviewSubmission(req.db, req.tenantId, req.user.id, idParam(req), data));
  })
);
router.get('/:id', requireAdmissions, asyncHandler(async (req, res) => res.status(200).json(await service.loadForm(req.db, req.tenantId, idParam(req)))));
/** GET /enrollment-forms/:id/pdf-preview?template=modern — PDF de ejemplo con esa plantilla, sin guardar nada. */
router.get(
  '/:id/pdf-preview',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const template = z.enum(TEMPLATE_STYLES).optional().parse(req.query.template);
    sendPdf(res, await service.formPdfPreview(req.db, req.tenantId, idParam(req), template));
  })
);
router.put(
  '/:id',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        title: z.string().trim().min(3, 'Escribe el título (mínimo 3 caracteres).').max(150).optional(),
        description: z.string().trim().max(1000).nullable().optional(),
        fields: fieldsSchema.optional(),
        templateStyle: z.enum(TEMPLATE_STYLES).optional(),
      })
      .parse(req.body);
    res.status(200).json(await service.updateForm(req.db, req.tenantId, idParam(req), data));
  })
);
router.post(
  '/:id/status',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(['draft', 'published', 'closed']) }).parse(req.body);
    res.status(200).json(await service.setStatus(req.db, req.tenantId, idParam(req), status));
  })
);
router.delete(
  '/:id',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    await service.deleteForm(req.db, req.tenantId, idParam(req));
    res.status(204).send();
  })
);
router.get(
  '/:id/submissions',
  requireAdmissions,
  asyncHandler(async (req, res) => {
    const status = req.query.status ? z.enum(['pending', 'submitted', 'changes_requested', 'approved', 'rejected']).parse(req.query.status) : null;
    res.status(200).json(await service.listSubmissions(req.db, req.tenantId, idParam(req), { status }));
  })
);

module.exports = router;
