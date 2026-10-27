const { ApiError } = require('../../utils/ApiError');
const teacherScope = require('../access/teacherScope');
const { notify, guardiansOfStudents } = require('../notifications/notify');
const { generateRecognitionCertificate } = require('../../services/pdf/recognitionCertificate');
const { resolveLogoFileOrDefault } = require('../../services/storage/logoStorage');

/**
 * Reconocimientos a estudiantes (migración 065): un docente o la dirección
 * reconoce un logro de un alumno y se avisa a sus representantes con un
 * diseño de celebración (campana, Centro de notificaciones y portal).
 *
 * Alcance:
 *   - administración: todos los alumnos;
 *   - docente: los alumnos de su carga; edita o elimina solo los que otorgó.
 */

const CATEGORIES = {
  excellence: { label: 'Excelencia académica', icon: 'graduation' },
  effort: { label: 'Esfuerzo y superación', icon: 'trendingUp' },
  conduct: { label: 'Conducta ejemplar', icon: 'shield' },
  leadership: { label: 'Liderazgo', icon: 'users' },
  solidarity: { label: 'Compañerismo y solidaridad', icon: 'users' },
  sports: { label: 'Deportes', icon: 'star' },
  arts: { label: 'Arte y cultura', icon: 'sparkles' },
  other: { label: 'Logro especial', icon: 'star' },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d ? String(d).slice(0, 10) : null);

/** Reconocimiento + alumno (con su grado y sección vigentes) + quién lo otorgó. */
function baseQuery(trx, tenantId) {
  return trx('student_recognitions as r')
    .join('students as s', 's.id', 'r.student_id')
    .leftJoin('staff as st', 'st.id', 'r.awarded_by_staff_id')
    .leftJoin('users as u', 'u.id', 'r.awarded_by_user_id')
    .leftJoin('school_periods as sp', 'sp.id', 'r.school_period_id')
    .joinRaw(
      `LEFT JOIN LATERAL (
         SELECT g.name AS grade_name, sec.name AS section_name
         FROM enrollments e JOIN sections sec ON sec.id = e.section_id JOIN grades g ON g.id = sec.grade_id
         WHERE e.student_id = r.student_id AND (r.school_period_id IS NULL OR sec.school_period_id = r.school_period_id)
         ORDER BY (e.status = 'active') DESC, e.enrolled_at DESC LIMIT 1
       ) cur ON true`
    )
    .where('r.tenant_id', tenantId)
    .select(
      'r.*',
      's.first_name as student_first_name',
      's.last_name as student_last_name',
      'cur.grade_name',
      'cur.section_name',
      'sp.name as school_period_name',
      trx.raw("COALESCE(NULLIF(concat_ws(' ', st.first_name, st.last_name), ''), u.full_name, 'El colegio') AS awarded_by_name"),
      trx.raw("CASE st.staff_type WHEN 'teaching' THEN 'Docente' WHEN 'coordinator' THEN 'Coordinación' WHEN 'administrative' THEN 'Administración' ELSE NULL END AS awarded_by_role")
    );
}

const shape = (r) => ({
  id: r.id,
  student_id: r.student_id,
  student_name: `${r.student_first_name} ${r.student_last_name}`,
  student_first_name: r.student_first_name,
  grade_name: r.grade_name || null,
  section_name: r.section_name || null,
  school_period_name: r.school_period_name || null,
  category: r.category,
  category_label: CATEGORIES[r.category]?.label || r.category,
  title: r.title,
  message: r.message,
  awarded_on: ymd(r.awarded_on),
  awarded_by_name: r.awarded_by_name,
  awarded_by_role: r.awarded_by_role,
  awarded_by_user_id: r.awarded_by_user_id,
  notified: Boolean(r.notification_id),
  created_at: r.created_at,
});

/** GET /recognitions — docente: solo de los alumnos de su carga. */
async function listRecognitions(req, { studentId, category, q } = {}) {
  const scope = await teacherScope.getTeacherScope(req);
  const rows = await baseQuery(req.db, req.tenantId)
    .modify((query) => {
      if (studentId) query.andWhere('r.student_id', studentId);
      if (category) query.andWhere('r.category', category);
      if (q) query.andWhere((w) => w.whereILike('s.first_name', `%${q}%`).orWhereILike('s.last_name', `%${q}%`).orWhereILike('r.title', `%${q}%`));
      teacherScope.restrictStudents(query, scope, 'r.student_id', { activeOnly: false });
    })
    .orderBy([{ column: 'r.awarded_on', order: 'desc' }, { column: 'r.created_at', order: 'desc' }])
    .limit(500);
  return rows.map(shape);
}

/** Alumnos que el usuario puede reconocer (para el selector): activos, con su grado y sección. */
async function studentOptions(req) {
  const scope = await teacherScope.getTeacherScope(req);
  const query = req.db('students as s')
    .join('enrollments as e', function joinEnrollment() {
      this.on('e.student_id', 's.id').andOnVal('e.status', 'active');
    })
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .where({ 's.tenant_id': req.tenantId, 's.status': 'active', 'sp.is_active': true })
    .whereNull('sp.closed_at')
    .distinctOn('s.id')
    .select('s.id', 's.first_name', 's.last_name', 'g.name as grade_name', 'sec.name as section_name', 'g.sort_order', 'sp.start_date')
    .orderBy([{ column: 's.id' }, { column: 'sp.start_date', order: 'asc' }]);
  teacherScope.restrictStudents(query, scope, 's.id');
  const rows = await query;
  return rows
    .map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, grade_name: r.grade_name, section_name: r.section_name, sort: r.sort_order }))
    .sort((a, b) => a.sort - b.sort || a.grade_name.localeCompare(b.grade_name) || a.section_name.localeCompare(b.section_name) || a.name.localeCompare(b.name, 'es'));
}

async function loadRecognition(trx, tenantId, id) {
  const row = await baseQuery(trx, tenantId).andWhere('r.id', id).first();
  if (!row) throw ApiError.notFound('Reconocimiento no encontrado.');
  return row;
}

/** Un docente solo modifica lo que otorgó (la administración, todo). */
async function assertCanModify(req, row) {
  const scope = await teacherScope.getTeacherScope(req);
  if (scope && row.awarded_by_user_id !== req.user.id) {
    throw ApiError.forbidden('Solo puedes modificar los reconocimientos que otorgaste.');
  }
}

/** Año escolar del alumno (su inscripción activa), para el historial. */
async function currentPeriodOf(trx, tenantId, studentId) {
  const row = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .orderBy('sp.start_date', 'asc')
    .first('sp.id');
  return row?.id || null;
}

/**
 * POST /recognitions — { studentId, category, title, message, awardedOn }.
 * Avisa a los representantes del alumno en la misma transacción.
 */
async function createRecognition(req, data) {
  const { db: trx, tenantId, user } = req;
  const student = await trx('students').where({ id: data.studentId, tenant_id: tenantId }).first('id', 'first_name', 'last_name');
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  await teacherScope.assertStudentAccess(req, student.id);
  const staff = await trx('staff').where({ tenant_id: tenantId, user_id: user.id }).first('id');

  const [created] = await trx('student_recognitions')
    .insert({
      tenant_id: tenantId,
      student_id: student.id,
      school_period_id: await currentPeriodOf(trx, tenantId, student.id),
      awarded_by_staff_id: staff?.id || null,
      awarded_by_user_id: user.id,
      category: data.category,
      title: data.title.trim(),
      message: data.message.trim(),
      awarded_on: data.awardedOn,
    })
    .returning('id');
  const recognition = shape(await loadRecognition(trx, tenantId, created.id));
  const notification = await notifyFamily(trx, tenantId, recognition);
  if (notification) await trx('student_recognitions').where({ id: created.id }).update({ notification_id: notification.id });
  return { ...recognition, notified: Boolean(notification) };
}

/**
 * Aviso a los representantes: título y texto de celebración; `data` lleva todo
 * lo que necesita la tarjeta festiva (alumno, categoría, título, mensaje, quién y cuándo).
 */
async function notifyFamily(trx, tenantId, r) {
  const guardianIds = await guardiansOfStudents(trx, tenantId, [r.student_id]);
  if (!guardianIds.length) return null;
  const body = `¡Felicitaciones! ${r.student_first_name} recibió el reconocimiento «${r.title}» (${r.category_label}), otorgado por ${r.awarded_by_name}: ${r.message}`;
  const { bell } = await notify(trx, tenantId, {
    event: 'recognition',
    guardianIds,
    title: `🏅 ¡Reconocimiento para ${r.student_first_name}!`,
    body: body.length <= 500 ? body : `${body.slice(0, 497)}…`,
    data: {
      recognition_id: r.id,
      student_id: r.student_id,
      student_name: r.student_name,
      grade_name: r.grade_name,
      section_name: r.section_name,
      category: r.category,
      category_label: r.category_label,
      title: r.title,
      message: r.message,
      awarded_by_name: r.awarded_by_name,
      awarded_by_role: r.awarded_by_role,
      awarded_on: r.awarded_on,
    },
    links: { guardians: `/portal/students/${r.student_id}?tab=recognitions` },
    linkLabel: 'Ver sus reconocimientos',
    dedupeKey: `recognition:${r.id}`,
  });
  return bell;
}

/** PUT /recognitions/:id — corrige el texto (no vuelve a avisar a la familia). */
async function updateRecognition(req, id, data) {
  const row = await loadRecognition(req.db, req.tenantId, id);
  await assertCanModify(req, row);
  const patch = {};
  if (data.category) patch.category = data.category;
  if (data.title) patch.title = data.title.trim();
  if (data.message) patch.message = data.message.trim();
  if (data.awardedOn) patch.awarded_on = data.awardedOn;
  await req.db('student_recognitions').where({ id }).update({ ...patch, updated_at: req.db.fn.now() });
  return shape(await loadRecognition(req.db, req.tenantId, id));
}

/** DELETE /recognitions/:id — también retira el aviso de la campana de la familia. */
async function deleteRecognition(req, id) {
  const row = await loadRecognition(req.db, req.tenantId, id);
  await assertCanModify(req, row);
  await req.db('student_recognitions').where({ id }).delete();
  if (row.notification_id) await req.db('notifications').where({ id: row.notification_id }).delete();
}

/** Portal: los reconocimientos de un alumno del representante (la ruta valida el vínculo). */
async function getStudentRecognitionsForGuardian(trx, tenantId, studentId) {
  const rows = await baseQuery(trx, tenantId).andWhere('r.student_id', studentId).orderBy('r.awarded_on', 'desc');
  return rows.map(shape).map(({ awarded_by_user_id, notified, ...r }) => r);
}

/**
 * Certificado en PDF (diploma A4 horizontal, con el logo del colegio).
 * `studentId`: si se indica (portal), el reconocimiento debe ser de ese alumno.
 * Devuelve { buffer, filename }.
 */
async function certificatePdf(trx, tenantId, id, { studentId = null } = {}) {
  const row = await baseQuery(trx, tenantId).andWhere('r.id', id).modify((q) => studentId && q.andWhere('r.student_id', studentId)).first();
  if (!row) throw ApiError.notFound('Reconocimiento no encontrado.');
  const r = shape(row);
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const settings = await trx('tenant_settings').where({ tenant_id: tenantId }).first('logo_url', 'rif');
  const buffer = await generateRecognitionCertificate({
    tenant: { name: tenant.name, logoPath: resolveLogoFileOrDefault(settings?.logo_url), rif: settings?.rif || null },
    recognition: {
      id: r.id,
      title: r.title,
      message: r.message,
      category: r.category,
      categoryLabel: r.category_label,
      awardedOn: r.awarded_on,
      awardedByName: r.awarded_by_name,
      awardedByRole: r.awarded_by_role,
      studentName: r.student_name,
      gradeName: r.grade_name,
      sectionName: r.section_name,
      schoolPeriodName: r.school_period_name,
    },
  });
  // Nombre del archivo sin tildes ni espacios: "reconocimiento-lucas-garcia-castillo-2026-10-26.pdf".
  const slug = r.student_name.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return { buffer, filename: `reconocimiento-${slug}-${r.awarded_on}.pdf` };
}

/** Personal: el certificado de un reconocimiento de sus alumnos (docente: de su carga). */
async function certificateForStaff(req, id) {
  const row = await loadRecognition(req.db, req.tenantId, id);
  await teacherScope.assertStudentAccess(req, row.student_id);
  return certificatePdf(req.db, req.tenantId, id);
}

module.exports = {
  certificatePdf,
  certificateForStaff,
  CATEGORIES,
  CATEGORY_KEYS,
  listRecognitions,
  studentOptions,
  createRecognition,
  updateRecognition,
  deleteRecognition,
  getStudentRecognitionsForGuardian,
};
