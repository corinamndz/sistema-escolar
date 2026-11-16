const { ApiError } = require('../../utils/ApiError');
const forms = require('./enrollmentForm.service');
const notifications = require('../notifications/notification.service');
const { ADMIN_ROLE, ADMISSIONS_ROLE } = require('../../middlewares/admin.middleware');

/**
 * Solicitud de cupo pública (migración 098): una planilla de inscripción marcada
 * con `public_intake` se muestra en el sitio web del colegio (/colegio/<slug>) y
 * cualquiera la llena SIN cuenta. Llega a «Planillas recibidas» como cualquier
 * otra, con source = 'web', sin representante con cuenta y con el contacto de
 * quien la pidió (web_contact). Se revisa y se aprueba igual que las demás.
 * Cada solicitud nueva avisa en la campana a Administración y Admisiones.
 *
 * Solo se ofrece si: el sitio está publicado, la planilla está marcada, publicada
 * y su año escolar sigue abierto. Las preguntas de tipo foto no se piden en la
 * web (subir archivos sin sesión es otro riesgo): las pide el colegio después.
 */

const notAvailable = () => ApiError.notFound('La solicitud de cupo no está disponible en este momento.');

/** La planilla de la solicitud de cupo de este colegio, si se puede llenar; o null. */
async function activeIntake(trx, tenantId) {
  const form = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where({ 'f.tenant_id': tenantId, 'f.public_intake': true, 'f.status': 'published' })
    .whereNull('sp.closed_at')
    .first('f.id', 'f.title', 'f.description', 'f.fields', 'sp.name as school_period_name');
  if (!form) return null;
  // Sin preguntas de foto (ver arriba).
  return { ...form, fields: (form.fields || []).filter((f) => f.type !== 'photo') };
}

/**
 * Qué datos de la solicitud ya pregunta la planilla (misma detección que la
 * precarga: enrollmentForm.service prefillMap) → ids de esos campos o null. Lo
 * que la planilla ya pregunta no se vuelve a pedir: se toma de sus respuestas.
 */
function coverage(fields) {
  const map = forms.prefillMap(fields);
  const idOf = (key) => Object.keys(map).find((id) => map[id] === key) || null;
  return {
    applicant: { first: idOf('student.first_name'), last: idOf('student.last_name'), full: idOf('student.full_name') },
    contact: {
      name: idOf('guardian.full_name'),
      first: idOf('guardian.first_name'),
      last: idOf('guardian.last_name'),
      national_id: idOf('guardian.national_id'),
      phone: idOf('guardian.phone'),
      email: idOf('guardian.email'),
    },
  };
}

/** Lo que la página pide además de la planilla (lo que la planilla no cubre). */
function asksFor(cov) {
  const c = cov.contact;
  return {
    applicant: !(cov.applicant.full || (cov.applicant.first && cov.applicant.last)),
    contact: { name: !(c.name || (c.first && c.last)), national_id: !c.national_id, phone: !c.phone, email: !c.email },
  };
}

/** Lo que ve el visitante: título, descripción, año, preguntas y qué datos extra se piden. */
async function publicForm(trx, tenantId) {
  const form = await activeIntake(trx, tenantId);
  if (!form) throw notAvailable();
  return { title: form.title, description: form.description, school_period_name: form.school_period_name, fields: form.fields, asks: asksFor(coverage(form.fields)) };
}

const PHONE = /^[0-9+()\-\s.]{7,25}$/;

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Usuarios ACTIVOS con el rol de sistema Administrador o Admisiones: quienes revisan las solicitudes. */
async function admissionsUserIds(trx, tenantId) {
  return trx('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'u.tenant_id': tenantId, 'u.status': 'active', 'r.tenant_id': tenantId, 'r.is_system': true })
    .whereIn('r.name', [ADMIN_ROLE, ADMISSIONS_ROLE])
    .distinct()
    .pluck('u.id');
}

/**
 * Aviso en la campana de Administración y Admisiones: llegó una solicitud de cupo
 * por la web. Lleva a «Planillas recibidas» filtrada por origen web. En un
 * SAVEPOINT: si el aviso falla, la solicitud se guarda igual.
 */
async function notifyAdmissions(trx, tenantId, { id, applicantName, formTitle, period }) {
  try {
    await trx.transaction(async (sp) => {
      const userIds = await admissionsUserIds(sp, tenantId);
      if (!userIds.length) return;
      await notifications.createNotification(sp, tenantId, {
        type: 'enrollment_form',
        title: 'Nueva solicitud de cupo desde la web',
        body: `${applicantName} solicitó cupo (${formTitle}${period ? `, ${period}` : ''}). Revísala en «Planillas recibidas».`,
        data: { submission_id: id, source: 'web', link_label: 'Ver solicitudes web', links: { users: '/enrollment-submissions?origen=web' } },
        targetUserIds: userIds,
      });
    });
  } catch (err) {
    console.error('No se pudo avisar a Admisiones de la solicitud de cupo', err);
  }
}

/**
 * Recibe una solicitud de la web. `input` ya validado en la ruta:
 *   { applicantName, answers, contact: { name, national_id, phone, email } }
 * → { id, applicant_name, contact }. Avisa en la campana a Administración y Admisiones.
 */
async function submit(trx, tenantId, input, meta = {}) {
  const form = await activeIntake(trx, tenantId);
  if (!form) throw notAvailable();
  const clean = forms.validateAnswers(form.fields, input.answers || {});
  // Lo que la planilla ya pregunta se toma de sus respuestas; lo demás, de los campos extra.
  const cov = coverage(form.fields);
  const a = (id) => (id && clean[id] !== undefined && clean[id] !== null ? String(clean[id]).trim() : '');
  const join = (...parts) => parts.filter(Boolean).join(' ');
  const applicantName = clip(a(cov.applicant.full) || join(a(cov.applicant.first), a(cov.applicant.last)) || input.applicantName, 150);
  const contact = {
    name: clip(a(cov.contact.name) || join(a(cov.contact.first), a(cov.contact.last)) || input.contact?.name, 150),
    national_id: clip(a(cov.contact.national_id) || input.contact?.national_id, 30) || null,
    phone: clip(a(cov.contact.phone) || input.contact?.phone, 30),
    email: clip(a(cov.contact.email) || input.contact?.email, 150).toLowerCase() || null,
  };
  const missing = [];
  if (applicantName.length < 3) missing.push({ path: 'applicantName', message: 'Escribe el nombre completo del aspirante.' });
  if (contact.name.length < 3) missing.push({ path: 'contact.name', message: 'Escribe tu nombre y apellido.' });
  if (!PHONE.test(contact.phone)) missing.push({ path: 'contact.phone', message: 'Escribe un teléfono válido para que el colegio te responda.' });
  if (missing.length) throw ApiError.badRequest('Revisa los datos marcados.', missing);
  const [{ id }] = await trx('enrollment_form_submissions')
    .insert({
      tenant_id: tenantId,
      form_id: form.id,
      guardian_id: null,
      student_id: null,
      applicant_name: applicantName,
      answers: JSON.stringify(clean),
      fields_snapshot: JSON.stringify(form.fields),
      status: 'submitted',
      source: 'web',
      web_contact: JSON.stringify(contact),
      web_meta: JSON.stringify({ ip: clip(meta.ip, 64) || null, user_agent: clip(meta.userAgent, 300) || null }),
      submitted_at: trx.fn.now(),
    })
    .returning('id');
  await notifyAdmissions(trx, tenantId, { id, applicantName, formTitle: form.title, period: form.school_period_name });
  // A quien envía se le confirma lo que se entendió (son sus propios datos).
  return { id, applicant_name: applicantName, contact: { phone: contact.phone, email: contact.email } };
}

/**
 * PUT /enrollment-forms/:id/public-intake { enabled } — marca (o desmarca) la
 * planilla como solicitud de cupo de la web. Solo una por colegio: marcar una
 * desmarca la anterior. → { public_intake, warnings: [...] } (qué falta para que se vea).
 */
async function setPublicIntake(trx, tenantId, formId, enabled) {
  const form = await forms.loadForm(trx, tenantId, formId);
  if (enabled) {
    await trx('enrollment_forms').where({ tenant_id: tenantId, public_intake: true }).whereNot({ id: formId }).update({ public_intake: false });
  }
  await trx('enrollment_forms').where({ id: formId }).update({ public_intake: Boolean(enabled), updated_at: trx.fn.now() });
  const warnings = [];
  if (enabled) {
    if (form.status !== 'published') warnings.push('La planilla no está publicada: publícala para que se pueda llenar.');
    if (form.period_closed_at) warnings.push(`El año escolar ${form.school_period_name} está cerrado: la solicitud no se mostrará.`);
    const site = await trx('school_websites').where({ tenant_id: tenantId }).first('is_published');
    if (!site?.is_published) warnings.push('El sitio web del colegio no está publicado: publícalo en Administración → Sitio web.');
    if ((form.fields || []).some((f) => f.type === 'photo')) warnings.push('Las preguntas de foto no se piden en la web: el colegio las solicita al revisar.');
  }
  return { public_intake: Boolean(enabled), warnings };
}

module.exports = { activeIntake, publicForm, submit, setPublicIntake, coverage };
