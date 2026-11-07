const { ApiError } = require('../../utils/ApiError');
const { notify } = require('../notifications/notify');
const { generateEnrollmentFormPdf } = require('../../services/pdf/enrollmentFormGenerator');
const { resolveLogoFileOrDefault } = require('../../services/storage/logoStorage');
const { photoPath, isPhotoName } = require('../../services/storage/enrollmentPhotoStorage');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');

/**
 * Planillas de inscripción personalizables (migración 078).
 *
 * El colegio diseña la planilla de un año escolar (enrollment_forms.fields,
 * JSONB) y la publica; cada representante la completa por alumno (o por un
 * aspirante nuevo) y la administración la revisa: aprueba, rechaza o pide
 * correcciones. La respuesta guarda la versión de los campos con que se envió
 * (fields_snapshot), así una edición posterior de la planilla no la desordena.
 */

// photo: foto del alumno (una por planilla); va en la esquina superior derecha del PDF.
const FIELD_TYPES = ['section', 'short_text', 'long_text', 'number', 'date', 'email', 'phone', 'select', 'radio', 'checkboxes', 'checkbox', 'photo'];
const WITH_OPTIONS = ['select', 'radio', 'checkboxes'];
const MAX_FIELDS = 80;
const REVIEW_LABELS = { approved: 'aprobada', rejected: 'rechazada', changes_requested: 'devuelta para corregir' };
// 'pending' = «Por llenar»: la planilla que la promoción le asigna al representante (migración 082).
// Está vacía y sin fecha de envío; no cuenta como recibida hasta que la familia la envía.
const PENDING = 'pending';
/** Por qué una planilla no se puede revisar/eliminar en su estado actual. */
const notOpenMessage = (status, verb = 'modificar') =>
  status === PENDING ? 'El representante todavía no ha llenado esta planilla.' : `Esta planilla ya fue ${REVIEW_LABELS[status]}: no se puede ${verb}.`;

// ---------- Estructura de la planilla ----------

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * Datos del sistema que pueden precargar un campo (re-inscripción de un alumno
 * ya registrado). `types`: tipos de campo donde tiene sentido.
 */
const TEXTY = ['short_text', 'long_text'];
/** De quién son los datos de una sección (ver sectionScopeOf). */
const SECTION_SCOPES = ['student', 'guardian', 'none'];
const PREFILL_SOURCES = {
  'student.first_name': { label: 'Alumno · nombres', types: TEXTY },
  'student.last_name': { label: 'Alumno · apellidos', types: TEXTY },
  'student.full_name': { label: 'Alumno · nombre completo', types: TEXTY },
  'student.national_id': { label: 'Alumno · cédula / identificador', types: [...TEXTY, 'number'] },
  'student.birth_date': { label: 'Alumno · fecha de nacimiento', types: ['date'] },
  'student.grade': { label: 'Alumno · grado actual', types: [...TEXTY, 'select', 'radio'] },
  'student.section': { label: 'Alumno · grado y sección actual', types: TEXTY },
  'guardian.first_name': { label: 'Representante · nombres', types: TEXTY },
  'guardian.last_name': { label: 'Representante · apellidos', types: TEXTY },
  'guardian.full_name': { label: 'Representante · nombre completo', types: TEXTY },
  'guardian.national_id': { label: 'Representante · cédula', types: [...TEXTY, 'number'] },
  'guardian.phone': { label: 'Representante · teléfono', types: [...TEXTY, 'phone'] },
  'guardian.email': { label: 'Representante · correo', types: [...TEXTY, 'email'] },
  'guardian.relationship': { label: 'Representante · parentesco', types: [...TEXTY, 'select', 'radio'] },
};

/**
 * Valida y normaliza los campos que envía el diseñador. Lanza 400 con el
 * detalle por campo (`fields.<i>.<prop>`) si algo no es válido.
 */
function normalizeFields(fields) {
  if (!Array.isArray(fields)) throw ApiError.badRequest('Los campos de la planilla no son válidos.');
  if (fields.length > MAX_FIELDS) throw ApiError.badRequest(`Máximo ${MAX_FIELDS} campos por planilla.`);
  const errors = [];
  const ids = new Set();
  const out = fields.map((f, i) => {
    const type = FIELD_TYPES.includes(f?.type) ? f.type : null;
    const id = String(f?.id || '');
    const label = clip(f?.label, 200);
    if (!type) errors.push({ path: `fields.${i}.type`, message: 'Tipo de campo inválido.' });
    if (!/^[a-z0-9_]{1,40}$/.test(id) || ids.has(id)) errors.push({ path: `fields.${i}.id`, message: 'Identificador inválido o repetido.' });
    ids.add(id);
    if (!label) errors.push({ path: `fields.${i}.label`, message: type === 'section' ? 'Ponle título a la sección.' : 'Ponle nombre a la pregunta.' });
    const field = { id, type, label };
    const help = clip(f?.help, 300);
    if (help) field.help = help;
    if (type !== 'section') field.required = Boolean(f?.required);
    if (['short_text', 'long_text', 'number', 'email', 'phone'].includes(type)) {
      const placeholder = clip(f?.placeholder, 120);
      if (placeholder) field.placeholder = placeholder;
    }
    // Prellenado (re-inscripción): dato del sistema que precarga el campo.
    // Sin `prefill` = automático (se deduce de la pregunta); 'none' = nunca.
    // Sección: de quién son sus datos (alumno / representante / otro); sin elegir = se deduce del título.
    if (type === 'section' && f?.scope) {
      if (SECTION_SCOPES.includes(f.scope)) field.scope = f.scope;
      else errors.push({ path: `fields.${i}.scope`, message: 'Tipo de sección inválido.' });
    }
    if (f?.prefill && type && type !== 'section') {
      if (f.prefill === 'none' || (PREFILL_SOURCES[f.prefill] && PREFILL_SOURCES[f.prefill].types.includes(type))) field.prefill = f.prefill;
      else errors.push({ path: `fields.${i}.prefill`, message: `«${label || 'Pregunta'}»: ese dato no se puede precargar en este tipo de campo.` });
    }
    if (WITH_OPTIONS.includes(type)) {
      const options = [...new Set((Array.isArray(f?.options) ? f.options : []).map((o) => clip(o, 100)).filter(Boolean))].slice(0, 50);
      if (!options.length) errors.push({ path: `fields.${i}.options`, message: `«${label || 'Pregunta'}» necesita al menos una opción.` });
      field.options = options;
    }
    return field;
  });
  const photos = out.filter((x) => x.type === 'photo');
  if (photos.length > 1) errors.push({ path: `fields.${out.lastIndexOf(photos[1])}.type`, message: 'Solo se admite una foto del alumno por planilla.' });
  if (errors.length) throw ApiError.badRequest(errors[0].message, errors);
  return out;
}

/** Plantilla inicial de una planilla nueva (el colegio la ajusta a su gusto). */
const STARTER_FIELDS = [
  { id: 'sec_alumno', type: 'section', label: 'Datos del alumno', help: 'Tal como aparecen en su partida de nacimiento.' },
  { id: 'foto_alumno', type: 'photo', label: 'Foto del alumno (tipo carnet)', help: 'De frente, fondo claro. JPG o PNG.' },
  { id: 'nombres', type: 'short_text', label: 'Nombres del alumno', required: true, prefill: 'student.first_name' },
  { id: 'apellidos', type: 'short_text', label: 'Apellidos del alumno', required: true, prefill: 'student.last_name' },
  { id: 'cedula_alumno', type: 'short_text', label: 'Cédula o cédula escolar del alumno', prefill: 'student.national_id' },
  { id: 'fecha_nacimiento', type: 'date', label: 'Fecha de nacimiento', required: true, prefill: 'student.birth_date' },
  { id: 'grado_solicitado', type: 'select', label: 'Grado al que aspira', required: true, options: ['Educación Inicial', '1er Grado', '2do Grado', '3er Grado', '4to Grado', '5to Grado', '6to Grado', '1er Año', '2do Año', '3er Año', '4to Año', '5to Año'] },
  { id: 'sec_representante', type: 'section', label: 'Datos del representante' },
  { id: 'rep_nombre', type: 'short_text', label: 'Nombre completo del representante', required: true, prefill: 'guardian.full_name' },
  { id: 'rep_cedula', type: 'short_text', label: 'Cédula del representante', required: true, prefill: 'guardian.national_id' },
  { id: 'rep_parentesco', type: 'short_text', label: 'Parentesco con el alumno', prefill: 'guardian.relationship' },
  { id: 'rep_telefono', type: 'phone', label: 'Teléfono del representante', required: true, prefill: 'guardian.phone' },
  { id: 'rep_correo', type: 'email', label: 'Correo del representante', prefill: 'guardian.email' },
  { id: 'sec_salud', type: 'section', label: 'Salud' },
  { id: 'alergias', type: 'long_text', label: 'Alergias o condiciones médicas', help: 'Escribe «Ninguna» si no aplica.' },
  { id: 'sec_contacto', type: 'section', label: 'Contacto de emergencia' },
  { id: 'contacto_nombre', type: 'short_text', label: 'Nombre del contacto', required: true },
  { id: 'contacto_telefono', type: 'phone', label: 'Teléfono', required: true },
  { id: 'acepta_normas', type: 'checkbox', label: 'Declaro que la información es verdadera y acepto las normas de convivencia del colegio.', required: true },
];

// ---------- Validación de respuestas ----------

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || v === false;

/**
 * Valida las respuestas contra los campos. Devuelve solo las respuestas de
 * campos conocidos, normalizadas; lanza 400 con `answers.<id>` por campo.
 */
function validateAnswers(fields, answers = {}) {
  const errors = [];
  const out = {};
  for (const f of fields) {
    if (f.type === 'section') continue;
    let v = answers[f.id];
    if (typeof v === 'string') v = v.trim();
    const err = (message) => errors.push({ path: `answers.${f.id}`, message });
    if (isEmpty(v)) {
      if (f.required) err(f.type === 'checkbox' ? 'Debes marcar esta casilla.' : 'Este campo es obligatorio.');
      continue;
    }
    switch (f.type) {
      case 'short_text':
        if (typeof v !== 'string' || v.length > 200) err('Máximo 200 caracteres.');
        break;
      case 'long_text':
        if (typeof v !== 'string' || v.length > 3000) err('Máximo 3000 caracteres.');
        break;
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) err('Escribe un número.');
        else v = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) err('Fecha inválida.');
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v)) || String(v).length > 150) err('Correo inválido.');
        break;
      case 'phone':
        if (!/^[0-9+()\-\s.]{7,25}$/.test(String(v))) err('Teléfono inválido.');
        break;
      case 'select':
      case 'radio':
        if (!f.options.includes(v)) err('Elige una de las opciones.');
        break;
      case 'checkboxes':
        if (!Array.isArray(v) || v.some((x) => !f.options.includes(x))) err('Opciones inválidas.');
        else v = f.options.filter((o) => v.includes(o)); // orden de la planilla, sin repetidos
        break;
      case 'checkbox':
        if (v !== true) err('Valor inválido.');
        break;
      case 'photo':
        if (!isPhotoName(v)) err('Foto inválida: vuelve a subirla.');
        break;
      default:
        break;
    }
    out[f.id] = v;
  }
  if (errors.length) throw ApiError.badRequest('Revisa los campos marcados.', errors);
  return out;
}

// ---------- Administración ----------

async function loadForm(trx, tenantId, id) {
  const form = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where({ 'f.id': id, 'f.tenant_id': tenantId })
    .first('f.*', 'sp.name as school_period_name', 'sp.closed_at as period_closed_at');
  if (!form) throw ApiError.notFound('Planilla no encontrada.');
  return form;
}

async function listForms(trx, tenantId) {
  return trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where('f.tenant_id', tenantId)
    .select(
      'f.id',
      'f.title',
      'f.status',
      'f.school_period_id',
      'sp.name as school_period_name',
      'f.updated_at',
      'f.published_at',
      trx.raw("jsonb_array_length(f.fields) - (SELECT count(*) FROM jsonb_array_elements(f.fields) e WHERE e->>'type' = 'section')::int AS question_count"),
      trx.raw("(SELECT count(*)::int FROM enrollment_form_submissions s WHERE s.form_id = f.id AND s.status <> 'pending') AS submissions"),
      trx.raw("(SELECT count(*)::int FROM enrollment_form_submissions s WHERE s.form_id = f.id AND s.status = 'submitted') AS pending"),
      // Asignadas por la promoción que la familia aún no llena.
      trx.raw("(SELECT count(*)::int FROM enrollment_form_submissions s WHERE s.form_id = f.id AND s.status = 'pending') AS awaiting")
    )
    .orderBy([{ column: 'sp.start_date', order: 'desc' }, { column: 'f.created_at', order: 'desc' }]);
}

async function createForm(trx, tenantId, userId, { schoolPeriodId, title, description = null, copyFromId = null }) {
  const period = await trx('school_periods').where({ id: schoolPeriodId, tenant_id: tenantId }).first('id', 'closed_at', 'name');
  if (!period) throw ApiError.badRequest('Año escolar inválido.', [{ path: 'schoolPeriodId', message: 'Año escolar inválido.' }]);
  if (period.closed_at) throw ApiError.unprocessable(`El año escolar ${period.name} está finalizado.`);
  let fields = STARTER_FIELDS;
  if (copyFromId) fields = (await loadForm(trx, tenantId, copyFromId)).fields;
  const [row] = await trx('enrollment_forms')
    .insert({ tenant_id: tenantId, school_period_id: schoolPeriodId, title: title.trim(), description: description?.trim() || null, fields: JSON.stringify(fields), created_by: userId })
    .returning('id');
  return loadForm(trx, tenantId, row.id);
}

async function updateForm(trx, tenantId, id, { title, description, fields }) {
  await loadForm(trx, tenantId, id);
  const patch = { updated_at: trx.fn.now() };
  if (title !== undefined) patch.title = title.trim();
  if (description !== undefined) patch.description = description?.trim() || null;
  if (fields !== undefined) patch.fields = JSON.stringify(normalizeFields(fields));
  await trx('enrollment_forms').where({ id }).update(patch);
  return loadForm(trx, tenantId, id);
}

async function setStatus(trx, tenantId, id, status) {
  const form = await loadForm(trx, tenantId, id);
  if (status === 'published') {
    if (form.period_closed_at) throw ApiError.unprocessable(`El año escolar ${form.school_period_name} está finalizado.`);
    if (!form.fields.some((f) => f.type !== 'section')) throw ApiError.unprocessable('Agrega al menos una pregunta antes de publicar.');
    normalizeFields(form.fields); // que lo guardado siga siendo válido
  }
  await trx('enrollment_forms')
    .where({ id })
    .update({ status, updated_at: trx.fn.now(), ...(status === 'published' && !form.published_at ? { published_at: trx.fn.now() } : {}) });
  // Primera publicación: las familias reciben el aviso de que deben completarla.
  if (status === 'published' && !form.published_at) await remindFamilies(trx, tenantId, { form });
  return loadForm(trx, tenantId, id);
}

async function deleteForm(trx, tenantId, id) {
  const form = await loadForm(trx, tenantId, id);
  // Las «Por llenar» (vacías) no impiden eliminarla: se van con ella.
  const { n } = await trx('enrollment_form_submissions').where({ form_id: id }).whereNot('status', PENDING).count('id as n').first();
  if (Number(n) > 0) throw ApiError.conflict(`«${form.title}» ya tiene ${n} planilla(s) recibida(s): ciérrala en lugar de eliminarla.`);
  await trx('enrollment_forms').where({ id }).delete();
}

const submissionColumns = (trx) => [
  's.id',
  's.form_id',
  's.status',
  's.student_id',
  's.applicant_name',
  's.review_note',
  's.reviewed_at',
  's.submitted_at',
  's.updated_at',
  'g.id as guardian_id',
  trx.raw("g.first_name || ' ' || g.last_name AS guardian_name"),
  'g.national_id as guardian_national_id',
  trx.raw("COALESCE(st.first_name || ' ' || st.last_name, s.applicant_name) AS student_name"),
];

async function listSubmissions(trx, tenantId, formId, { status = null } = {}) {
  await loadForm(trx, tenantId, formId);
  return trx('enrollment_form_submissions as s')
    .join('guardians as g', 'g.id', 's.guardian_id')
    .leftJoin('students as st', 'st.id', 's.student_id')
    .where({ 's.tenant_id': tenantId, 's.form_id': formId })
    .modify((q) => (status ? q.andWhere('s.status', status) : q.whereNot('s.status', PENDING)))
    .select(submissionColumns(trx))
    .orderByRaw("CASE s.status WHEN 'submitted' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END, s.submitted_at DESC");
}

/**
 * Bandeja del administrador: planillas recibidas de todos los formularios,
 * con filtros (estado, formulario, tipo, búsqueda por nombre o cédula) y el
 * conteo por estado para las pestañas.
 */
async function inbox(trx, tenantId, { status = null, formId = null, kind = null, q = null, schoolPeriodId = null } = {}) {
  const base = () =>
    trx('enrollment_form_submissions as s')
      .join('guardians as g', 'g.id', 's.guardian_id')
      .join('enrollment_forms as f', 'f.id', 's.form_id')
      .join('school_periods as sp', 'sp.id', 'f.school_period_id')
      .leftJoin('students as st', 'st.id', 's.student_id')
      .where('s.tenant_id', tenantId)
      .modify((x) => {
        if (formId) x.andWhere('s.form_id', formId);
        if (schoolPeriodId) x.andWhere('f.school_period_id', schoolPeriodId); // año escolar global (barra superior)
        if (kind === 'new') x.whereNull('s.student_id');
        if (kind === 'renewal') x.whereNotNull('s.student_id');
        if (q) {
          const like = `%${q.toLowerCase()}%`;
          x.andWhere((w) =>
            w
              .whereRaw("lower(COALESCE(st.first_name || ' ' || st.last_name, s.applicant_name)) LIKE ?", [like])
              .orWhereRaw("lower(g.first_name || ' ' || g.last_name) LIKE ?", [like])
              .orWhereRaw("coalesce(st.national_id, '') ILIKE ?", [like])
              .orWhereRaw("coalesce(g.national_id, '') ILIKE ?", [like])
          );
        }
      });
  const rows = await base()
    // «Todas» = las recibidas; las «Por llenar» solo en su pestaña.
    .modify((x) => (status ? x.andWhere('s.status', status) : x.whereNot('s.status', PENDING)))
    .select([...submissionColumns(trx), 'f.title as form_title', 'sp.name as school_period_name', 'st.national_id as student_national_id'])
    .orderByRaw("CASE s.status WHEN 'submitted' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END, s.submitted_at DESC")
    .limit(500);
  const counts = Object.fromEntries((await base().groupBy('s.status').select('s.status').count('* as n')).map((r) => [r.status, Number(r.n)]));
  const formsList = await trx('enrollment_forms as f').join('school_periods as sp', 'sp.id', 'f.school_period_id').where('f.tenant_id', tenantId).orderBy('sp.start_date', 'desc').select('f.id', 'f.title', 'f.school_period_id', 'sp.name as school_period_name');
  return { rows, counts, forms: formsList };
}

async function getSubmission(trx, tenantId, id) {
  const row = await trx('enrollment_form_submissions as s')
    .join('guardians as g', 'g.id', 's.guardian_id')
    .leftJoin('students as st', 'st.id', 's.student_id')
    .leftJoin('users as u', 'u.id', 's.reviewed_by')
    .where({ 's.id': id, 's.tenant_id': tenantId })
    .first([...submissionColumns(trx), 's.answers', 's.fields_snapshot', 'g.phone as guardian_phone', 'g.email as guardian_email', 'u.full_name as reviewed_by_name']);
  if (!row) throw ApiError.notFound('Planilla recibida no encontrada.');
  return row;
}

/** Aprueba, rechaza o devuelve para corregir; avisa al representante en su campana. */
async function reviewSubmission(trx, tenantId, userId, id, { status, note = null }) {
  const sub = await getSubmission(trx, tenantId, id);
  // Aprobar da de alta al alumno, sus representantes y la matrícula: enrollmentApproval.service.
  if (status === 'approved') throw ApiError.badRequest('Para aprobar usa «Aprobar e inscribir».');
  if (!['submitted', 'changes_requested'].includes(sub.status)) throw ApiError.conflict(notOpenMessage(sub.status, 'revisar'));
  if (!note?.trim()) {
    throw ApiError.badRequest('Explica el motivo al representante.', [{ path: 'note', message: 'Requerido.' }]);
  }
  await trx('enrollment_form_submissions')
    .where({ id })
    .update({ status, review_note: note?.trim() || null, reviewed_by: userId, reviewed_at: trx.fn.now(), updated_at: trx.fn.now() });
  const form = await loadForm(trx, tenantId, sub.form_id);
  await notify(trx, tenantId, {
    event: 'enrollment_form',
    guardianIds: [sub.guardian_id],
    title: `Planilla de inscripción ${REVIEW_LABELS[status]}`,
    body: `La planilla «${form.title}» de ${sub.student_name} fue ${REVIEW_LABELS[status]}.${note?.trim() ? ` ${note.trim()}` : ''}`,
    links: { guardians: '/portal/enrollment' },
    linkLabel: status === 'changes_requested' ? 'Corregir planilla' : 'Ver planilla',
    channels: { bell: true, email: false },
  });
  return getSubmission(trx, tenantId, id);
}

// ---------- Portal del representante ----------

async function guardianOf(trx, tenantId, userId) {
  const g = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id', 'first_name', 'last_name');
  if (!g) throw ApiError.forbidden('Esta sección es para representantes.');
  return g;
}

/**
 * Representante del portal: `who` es el id de usuario de la sesión (el
 * representante real) o `{ guardianId }` cuando el Administrador simula su
 * vista («Ver como representante»: solo lectura, ver la ruta /preview).
 */
async function resolveGuardian(trx, tenantId, who) {
  if (who && typeof who === 'object' && who.guardianId) {
    const g = await trx('guardians').where({ tenant_id: tenantId, id: who.guardianId }).first('id', 'first_name', 'last_name');
    if (!g) throw ApiError.notFound('Representante no encontrado.');
    return g;
  }
  return guardianOf(trx, tenantId, who);
}

/** Planillas publicadas, los alumnos del representante y lo que ya envió. */
async function portalOverview(trx, tenantId, userId) {
  const g = await resolveGuardian(trx, tenantId, userId);
  const forms = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where({ 'f.tenant_id': tenantId, 'f.status': 'published' })
    .whereNull('sp.closed_at')
    .orderBy('sp.start_date', 'desc')
    .select('f.id', 'f.title', 'f.description', 'f.fields', 'f.school_period_id', 'sp.name as school_period_name');
  const students = await trx('student_guardians as sg')
    .join('students as s', 's.id', 'sg.student_id')
    .where('sg.guardian_id', g.id)
    .orderBy(['s.first_name', 's.last_name'])
    .select('s.id', 's.first_name', 's.last_name', 's.status');
  const submissions = forms.length
    ? await trx('enrollment_form_submissions as s')
        .leftJoin('students as st', 'st.id', 's.student_id')
        .where('s.tenant_id', tenantId)
        .whereIn('s.form_id', forms.map((f) => f.id))
        // Las suyas y las «Por llenar» de sus alumnos (cualquiera de sus representantes puede llenarlas).
        .andWhere((w) => w.where('s.guardian_id', g.id).orWhere((x) => x.where('s.status', PENDING).whereIn('s.student_id', students.map((s) => s.id))))
        .select('s.id', 's.form_id', 's.student_id', 's.applicant_name', 's.status', 's.review_note', 's.answers', 's.fields_snapshot', 's.submitted_at', 's.reviewed_at', trx.raw("COALESCE(st.first_name || ' ' || st.last_name, s.applicant_name) AS student_name"))
        .orderBy('s.submitted_at', 'desc')
    : [];
  return { forms, students, submissions, reminders: await pendingEnrollments(trx, tenantId, forms, students) };
}

/**
 * Inscripciones pendientes de la familia: por cada año con planilla publicada,
 * cada alumno activo SIN planilla aprobada de ese año (regla de «Inscrito»,
 * ver enrollmentStatus.js). Incluye dónde quedó ubicado ese año (p. ej. tras la
 * promoción: «2do Grado · A») y en qué va su planilla:
 *   state     'missing' (sin enviar) | 'submitted' | 'changes_requested' | 'rejected'
 *   assigned  true si el colegio se la asignó al promoverlo (registro «Por llenar»)
 *
 * El año vigente le toca a todo alumno activo. Un año que no es el vigente (el
 * siguiente, ya preparado) solo a quien está ubicado en él —promovido o
 * repitiente— o ya tiene una planilla de ese año.
 */
async function pendingEnrollments(trx, tenantId, forms, students) {
  const active = students.filter((s) => s.status === 'active');
  if (!forms.length || !active.length) return [];
  const ids = active.map((s) => s.id);
  const periodIds = [...new Set(forms.map((f) => f.school_period_id))];
  const subs = await trx('enrollment_form_submissions as fs')
    .join('enrollment_forms as f', 'f.id', 'fs.form_id')
    .where('fs.tenant_id', tenantId)
    .whereIn('fs.student_id', ids)
    .whereIn('f.school_period_id', periodIds)
    .select('fs.student_id', 'fs.form_id', 'fs.status', 'f.school_period_id');
  const placed = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .whereIn('e.student_id', ids)
    .where('e.status', 'active')
    .whereIn('sec.school_period_id', periodIds)
    .select('e.student_id', 'sec.school_period_id', 'g.name as grade_name', 'sec.name as section_name');
  const current = await trx('school_periods as sp').where('sp.tenant_id', tenantId).orderByRaw(currentPeriodOrder('sp')).first('sp.id');
  const out = [];
  const RANK = { changes_requested: 0, submitted: 1, rejected: 2 };
  for (const f of forms) {
    for (const st of active) {
      const inPeriod = subs.filter((x) => x.student_id === st.id && x.school_period_id === f.school_period_id);
      if (inPeriod.some((x) => x.status === 'approved')) continue; // ya inscrito ese año
      const where = placed.find((p) => p.student_id === st.id && p.school_period_id === f.school_period_id);
      if (f.school_period_id !== current?.id && !where && !inPeriod.length) continue; // año siguiente: no le toca aún
      // Su planilla de esta convocatoria o, si la envió en otra del mismo año, la de esa
      // (la «Por llenar» cuenta como no enviada).
      const sent = inPeriod.filter((x) => x.status !== PENDING);
      const own = sent.find((x) => x.form_id === f.id) || [...sent].sort((a, b) => RANK[a.status] - RANK[b.status])[0];
      out.push({
        form_id: f.id,
        form_title: f.title,
        school_period_id: f.school_period_id,
        school_period_name: f.school_period_name,
        student_id: st.id,
        student_name: `${st.first_name} ${st.last_name}`,
        grade_name: where?.grade_name || null,
        section_name: where?.section_name || null,
        state: own?.status || 'missing',
        assigned: inPeriod.some((x) => x.status === PENDING),
      });
    }
  }
  return out;
}

/** Solo los recordatorios (aviso del inicio del portal): sin campos ni respuestas. */
async function portalReminders(trx, tenantId, userId) {
  const g = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
  if (!g) return [];
  const forms = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where({ 'f.tenant_id': tenantId, 'f.status': 'published' })
    .whereNull('sp.closed_at')
    .orderBy('sp.start_date', 'desc')
    .select('f.id', 'f.title', 'f.school_period_id', 'sp.name as school_period_name');
  const students = await trx('student_guardians as sg').join('students as s', 's.id', 'sg.student_id').where('sg.guardian_id', g.id).orderBy(['s.first_name', 's.last_name']).select('s.id', 's.first_name', 's.last_name', 's.status');
  return pendingEnrollments(trx, tenantId, forms, students);
}

/**
 * Aviso a las familias que deben completar la planilla de un año:
 *   - al PUBLICAR por primera vez la planilla (todas las familias con alumnos activos sin planilla aprobada de ese año);
 *   - al PROMOVER (cada familia, con el grado nuevo de sus alumnos), si la planilla de ese año ya está publicada.
 */
async function remindFamilies(trx, tenantId, { form, items = null }) {
  // items: [{ studentId, gradeName }] tras una promoción; null = todos los alumnos activos.
  const q = trx('student_guardians as sg')
    .join('students as s', 's.id', 'sg.student_id')
    .where({ 's.tenant_id': tenantId, 's.status': 'active' })
    .whereNotExists(
      trx('enrollment_form_submissions as fs')
        .join('enrollment_forms as f', 'f.id', 'fs.form_id')
        .whereRaw('fs.student_id = s.id')
        .where({ 'fs.status': 'approved', 'f.school_period_id': form.school_period_id })
    )
    .select('sg.guardian_id', 's.id as student_id', 's.first_name');
  if (items) q.whereIn('s.id', items.map((i) => i.studentId));
  const rows = await q;
  const byGuardian = new Map();
  rows.forEach((r) => byGuardian.set(r.guardian_id, [...(byGuardian.get(r.guardian_id) || []), r]));
  if (!byGuardian.size) return 0;
  if (!items) {
    await notify(trx, tenantId, {
      event: 'enrollment_form',
      guardianIds: [...byGuardian.keys()],
      title: `Inscripción ${form.school_period_name}: completa la planilla`,
      body: `Ya está disponible «${form.title}». Complétala para cada uno de tus representados: su inscripción para ${form.school_period_name} se activa cuando el colegio la apruebe.`,
      links: { guardians: '/portal/enrollment' },
      linkLabel: 'Completar planilla',
      dedupeKey: `enrollment-form-open:${form.id}`,
      channels: { bell: true, email: false },
    });
    return byGuardian.size;
  }
  for (const [guardianId, kids] of byGuardian) {
    const list = kids.map((k) => `${k.first_name} (${items.find((i) => i.studentId === k.student_id)?.gradeName || 'nuevo grado'})`).join(', ');
    await notify(trx, tenantId, {
      event: 'enrollment_form',
      guardianIds: [guardianId],
      title: `Inscripción ${form.school_period_name} pendiente`,
      body: `${list}: ${kids.length === 1 ? 'pasó' : 'pasaron'} al nuevo año escolar. Completa la planilla de inscripción de ${form.school_period_name} para activar su inscripción oficial.`,
      links: { guardians: '/portal/enrollment' },
      linkLabel: 'Completar planilla',
      channels: { bell: true, email: false },
    });
  }
  return byGuardian.size;
}

/** Título de la planilla del año nuevo a partir de la anterior («… 2026 - 2027» → «… 2027-2028»). */
function titleForPeriod(sourceTitle, periodName) {
  const re = /\b\d{4}\s*[-–/]\s*\d{4}\b/;
  if (sourceTitle && re.test(sourceTitle)) return sourceTitle.replace(re, periodName);
  return `Planilla de Inscripción ${periodName}`;
}

/**
 * La planilla del año escolar `period` para asignar tras la promoción:
 *   - la publicada (la más reciente);
 *   - si solo hay un borrador, ese (el colegio la está diseñando: las familias
 *     la verán al publicarla, y ahí reciben el aviso);
 *   - si el año no tiene ninguna, se CREA publicada, copiando las preguntas de
 *     la última planilla del colegio (o la plantilla inicial).
 * → { form, created }
 */
async function formForPeriod(trx, tenantId, userId, period) {
  const cols = ['f.id', 'f.title', 'f.status', 'f.fields', 'f.school_period_id', 'sp.name as school_period_name'];
  const existing = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where({ 'f.tenant_id': tenantId, 'f.school_period_id': period.id })
    .whereIn('f.status', ['published', 'draft'])
    .orderByRaw("(f.status = 'published') DESC, f.published_at DESC NULLS LAST, f.created_at DESC")
    .first(cols);
  if (existing) return { form: existing, created: false };

  const source = await trx('enrollment_forms as f')
    .join('school_periods as sp', 'sp.id', 'f.school_period_id')
    .where('f.tenant_id', tenantId)
    .orderByRaw("(f.status = 'published') DESC, sp.start_date DESC, f.created_at DESC")
    .first('f.title', 'f.description', 'f.fields');
  const [row] = await trx('enrollment_forms')
    .insert({
      tenant_id: tenantId,
      school_period_id: period.id,
      title: titleForPeriod(source?.title, period.name).slice(0, 150),
      description: source?.description || null,
      fields: JSON.stringify(source?.fields || STARTER_FIELDS),
      status: 'published',
      published_at: trx.fn.now(),
      created_by: userId,
    })
    .returning('id');
  const form = await trx('enrollment_forms as f').join('school_periods as sp', 'sp.id', 'f.school_period_id').where('f.id', row.id).first(cols);
  return { form, created: true };
}

/**
 * Tras la promoción (MISMA transacción): por cada alumno que pasa al año nuevo
 * —promovido o repitiente— se crea su planilla de ese año en estado «Por
 * llenar» (status 'pending'), asignada a su representante principal (o al
 * primero vinculado), con la matrícula nueva que la originó. Así la familia la
 * encuentra en su portal y el colegio ve quién falta.
 *
 *   items  [{ studentId, gradeName, enrollmentId }]
 * → { formId, formTitle, formStatus, formCreated, created, skipped, withoutGuardian, remindedFamilies }
 */
async function openAfterPromotion(trx, tenantId, userId, period, items) {
  const empty = { formId: null, formTitle: null, formStatus: null, formCreated: false, created: 0, skipped: 0, withoutGuardian: 0, remindedFamilies: 0 };
  if (!items.length) return empty;
  const { form, created: formCreated } = await formForPeriod(trx, tenantId, userId, period);
  const ids = items.map((i) => i.studentId);

  // Ya tiene planilla en esta convocatoria (cualquier estado) o una aprobada de ese año: no se duplica.
  const taken = new Set(
    (
      await trx('enrollment_form_submissions as fs')
        .join('enrollment_forms as f', 'f.id', 'fs.form_id')
        .where('fs.tenant_id', tenantId)
        .whereIn('fs.student_id', ids)
        .andWhere((w) => w.where('fs.form_id', form.id).orWhere((x) => x.where({ 'f.school_period_id': period.id, 'fs.status': 'approved' })))
        .select('fs.student_id')
    ).map((r) => r.student_id)
  );
  // Representante a quien se le asigna: el principal; si no hay, el primero vinculado.
  const links = await trx('student_guardians as sg')
    .join('guardians as g', 'g.id', 'sg.guardian_id')
    .where('g.tenant_id', tenantId)
    .whereIn('sg.student_id', ids)
    .orderBy([{ column: 'sg.is_primary', order: 'desc' }, { column: 'g.created_at', order: 'asc' }])
    .select('sg.student_id', 'sg.guardian_id');

  const out = { ...empty, formId: form.id, formTitle: form.title, formStatus: form.status, formCreated };
  for (const it of items) {
    if (taken.has(it.studentId)) {
      out.skipped += 1;
      continue;
    }
    const guardian = links.find((l) => l.student_id === it.studentId);
    if (!guardian) {
      out.withoutGuardian += 1; // sin representante: el colegio lo ve «Sin planilla» en el listado
      continue;
    }
    await trx('enrollment_form_submissions').insert({
      tenant_id: tenantId,
      form_id: form.id,
      guardian_id: guardian.guardian_id,
      student_id: it.studentId,
      enrollment_id: it.enrollmentId || null,
      status: PENDING,
      answers: JSON.stringify({}),
      fields_snapshot: JSON.stringify(form.fields),
      submitted_at: null,
    });
    taken.add(it.studentId);
    out.created += 1;
  }
  // Aviso en la campana (si la planilla ya está publicada; un borrador avisa al publicarse).
  if (form.status === 'published') out.remindedFamilies = await remindFamilies(trx, tenantId, { form, items });
  return out;
}

/** Deshacer una promoción: se quitan las planillas «Por llenar» que generó (las ya enviadas se conservan). */
async function dropPendingFor(trx, tenantId, enrollmentId) {
  return trx('enrollment_form_submissions').where({ tenant_id: tenantId, enrollment_id: enrollmentId, status: PENDING }).delete();
}

/**
 * Envía (o corrige) una planilla: por un alumno del representante o por un
 * aspirante nuevo. Solo se puede editar mientras está en revisión o devuelta.
 *
 * `dryRun` (simulación del Administrador, «Ver como representante»): hace
 * TODAS las validaciones del envío real —planilla abierta, alumno vinculado,
 * estado de su planilla, respuestas— y no guarda nada. La foto la sube el
 * representante: en la simulación no se exige.
 *   → { dryRun: true, ok: true, wouldUpdate: 'pending' | 'submitted' | … | null }
 */
async function submit(trx, tenantId, userId, formId, { studentId = null, applicantName = null, submissionId = null, answers = {} }, { dryRun = false } = {}) {
  const g = await resolveGuardian(trx, tenantId, userId);
  const form = await loadForm(trx, tenantId, formId);
  if (form.status !== 'published' || form.period_closed_at) throw ApiError.unprocessable('Esta planilla ya no recibe respuestas.');
  if (studentId) {
    const linked = await trx('student_guardians').where({ guardian_id: g.id, student_id: studentId }).first();
    if (!linked) throw ApiError.forbidden('Ese alumno no está asociado a tu cuenta.');
  } else if (!applicantName?.trim()) {
    throw ApiError.badRequest('Indica el nombre del aspirante.', [{ path: 'applicantName', message: 'Requerido.' }]);
  }
  const SIM_PHOTO = '00000000-0000-0000-0000-000000000000.jpg';
  const toCheck = dryRun
    ? { ...answers, ...Object.fromEntries(form.fields.filter((f) => f.type === 'photo' && !answers[f.id]).map((f) => [f.id, SIM_PHOTO])) }
    : answers;
  const clean = validateAnswers(form.fields, toCheck);
  // La foto debe haberse subido a este colegio (no se acepta un nombre inventado).
  for (const f of form.fields.filter((x) => x.type === 'photo' && clean[x.id] && clean[x.id] !== (dryRun ? SIM_PHOTO : null))) {
    if (!photoPath(tenantId, clean[f.id])) throw ApiError.badRequest('La foto no se encontró: vuelve a subirla.', [{ path: `answers.${f.id}`, message: 'Foto no encontrada.' }]);
  }

  // ¿Ya existe? (por alumno, o la del aspirante que se está corrigiendo)
  const existing = studentId
    ? await trx('enrollment_form_submissions').where({ form_id: formId, student_id: studentId }).first()
    : submissionId
      ? await trx('enrollment_form_submissions').where({ id: submissionId, form_id: formId, guardian_id: g.id }).first()
      : null;
  // La «Por llenar» de la promoción la puede completar cualquiera de sus representantes:
  // queda a nombre de quien la envía.
  const assigned = existing?.status === PENDING;
  if (existing && !assigned && existing.guardian_id !== g.id) throw ApiError.conflict('Otro representante ya envió la planilla de este alumno.');
  if (existing && ['approved', 'rejected'].includes(existing.status)) {
    throw ApiError.conflict(notOpenMessage(existing.status));
  }
  if (dryRun) return { dryRun: true, ok: true, wouldUpdate: existing?.status || null };
  const values = {
    ...(assigned ? { guardian_id: g.id } : {}),
    answers: JSON.stringify(clean),
    fields_snapshot: JSON.stringify(form.fields),
    status: 'submitted',
    applicant_name: studentId ? null : applicantName.trim().slice(0, 150),
    submitted_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  };
  let id;
  if (existing) {
    await trx('enrollment_form_submissions').where({ id: existing.id }).update(values);
    id = existing.id;
  } else {
    [{ id }] = await trx('enrollment_form_submissions')
      .insert({ ...values, tenant_id: tenantId, form_id: formId, guardian_id: g.id, student_id: studentId })
      .returning('id');
  }
  return { id, status: 'submitted', resubmitted: Boolean(existing) && !assigned };
}

// ---------- Prellenado (re-inscripción de un alumno registrado) ----------

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Dato del sistema que corresponde a un campo: el elegido en el diseñador o,
 * si no eligió (planillas viejas o preguntas nuevas), uno deducido del texto
 * de la pregunta. Las preguntas de contacto de emergencia / médico nunca se
 * deducen (no son el representante).
 */
function prefillSourceOf(f, sectionScope = null, { scopeChosen = false } = {}) {
  if (f.type === 'section' || f.prefill === 'none') return null;
  if (f.prefill) return PREFILL_SOURCES[f.prefill]?.types.includes(f.type) ? f.prefill : null;
  const l = norm(f.label);
  // Sección de emergencia, salud u otra persona: sus preguntas no se deducen, salvo que la
  // pregunta nombre a quién se refiere («Correo del representante») y el administrador no
  // haya marcado la sección como «no precargar».
  if (sectionScope === 'none' && (scopeChosen || !/representante|acudiente|alumno|estudiante/.test(l))) return null;
  if (/parentesco/.test(l)) return PREFILL_SOURCES['guardian.relationship'].types.includes(f.type) ? 'guardian.relationship' : null;
  if (/emergencia|contacto|medic|doctor|pediatra|retir|autoriz|padre|madre/.test(l) && !/representante/.test(l)) return null;
  // ¿De quién es el dato? Lo dice la pregunta («… del representante», «… del alumno») o,
  // si no lo dice, la sección donde está: «Nombre y Apellido» bajo «Representantes» es del representante.
  const who = /representante|acudiente/.test(l) ? 'guardian' : /alumno|estudiante|aspirante|nino|nina/.test(l) ? 'student' : sectionScope === 'guardian' ? 'guardian' : 'student';
  let key = null;
  if (f.type === 'date' && /nacimiento/.test(l)) key = 'student.birth_date';
  else if (/cedula|c\.i\b|documento|identific|identidad/.test(l)) key = `${who}.national_id`;
  else if (/parentesco|relacion con/.test(l)) key = 'guardian.relationship';
  else if (f.type === 'phone' || /telefono|celular/.test(l)) key = who === 'guardian' ? 'guardian.phone' : null;
  else if (f.type === 'email' || /correo|e-?mail/.test(l)) key = who === 'guardian' ? 'guardian.email' : null;
  else if (/nombres? y apellidos?|nombre completo/.test(l)) key = `${who}.full_name`;
  else if (/apellido/.test(l)) key = `${who}.last_name`;
  else if (/nombre/.test(l)) key = `${who}.first_name`;
  else if (/grado|ano escolar|curso/.test(l) && !/aspira|solicita|cursara|inscrib|proximo|nuevo/.test(l)) key = 'student.grade';
  return key && PREFILL_SOURCES[key].types.includes(f.type) ? key : null;
}

/**
 * ¿De quién son los datos de una sección? El que eligió el administrador en el
 * diseñador (`scope`) o, si no eligió, el deducido del título:
 *   'student'  datos del alumno       ('Datos del alumno', 'Estudiante'…)
 *   'guardian' datos del representante ('Representantes', 'Datos del representante legal'…)
 *   'none'     otra persona o tema    ('Contacto de emergencia', 'Salud'…): no se precarga
 *   null       sin pista: cada pregunta se juzga por su texto
 */
function sectionScopeOf(section) {
  if (SECTION_SCOPES.includes(section.scope)) return section.scope;
  const l = norm(`${section.label} ${section.help || ''}`);
  if (/emergencia/.test(l)) return 'none';
  if (/representante|acudiente|tutor|familia|padres|responsable/.test(l)) return 'guardian'; // «Datos de contacto del representante»
  if (/contacto|salud|medic|alergia|retir|autoriz/.test(l)) return 'none';
  if (/alumno|estudiante|aspirante|nino|nina/.test(l)) return 'student';
  return null;
}

/** { <id del campo>: dato del sistema } recorriendo la planilla con el contexto de cada sección. */
function prefillMap(fields = []) {
  const map = {};
  let scope = null;
  let scopeChosen = false;
  for (const f of fields) {
    if (f.type === 'section') {
      scope = sectionScopeOf(f);
      scopeChosen = SECTION_SCOPES.includes(f.scope);
      continue;
    }
    const key = prefillSourceOf(f, scope, { scopeChosen });
    if (key) map[f.id] = key;
  }
  return map;
}

/** Ajusta un valor al tipo de campo; null si no encaja (p. ej. no está entre las opciones). */
function fitValue(f, v) {
  if (v === undefined || v === null || v === '') return null;
  if (['select', 'radio'].includes(f.type)) return f.options.find((o) => norm(o) === norm(v)) || null;
  if (f.type === 'number') return Number.isFinite(Number(v)) ? Number(v) : null;
  if (f.type === 'phone') return /^[0-9+()\-\s.]{7,25}$/.test(String(v)) ? String(v) : null;
  if (f.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v)) ? String(v) : null;
  if (f.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null;
  if (f.type === 'short_text') return String(v).slice(0, 200);
  if (f.type === 'long_text') return String(v).slice(0, 3000);
  return v;
}

/**
 * Respuestas precargadas para la planilla de un alumno ya registrado:
 *   1) datos del sistema (ficha del alumno y del representante), y
 *   2) lo que el representante respondió en la planilla anterior del alumno
 *      (misma pregunta: mismo identificador o mismo texto y tipo) — salud,
 *      contactos, foto…
 * → { answers, sources: { <campo>: 'record' | 'previous' }, previous: { title } | null }
 */
async function prefill(trx, tenantId, userId, formId, studentId) {
  const g = await resolveGuardian(trx, tenantId, userId);
  const form = await loadForm(trx, tenantId, formId);
  const link = await trx('student_guardians').where({ guardian_id: g.id, student_id: studentId }).first('relationship');
  if (!link) throw ApiError.forbidden('Ese alumno no está asociado a tu cuenta.');
  // Consultas en serie: comparten la conexión de la transacción.
  const student = await trx('students').where({ tenant_id: tenantId, id: studentId }).first('first_name', 'last_name', 'national_id', 'birth_date');
  // Representante PRINCIPAL del alumno (JOIN con su vínculo: datos y parentesco reales). Si el
  // alumno no tiene principal marcado, el representante que está llenando la planilla.
  const guardianCols = ['g.id', 'g.first_name', 'g.last_name', 'g.national_id', 'g.phone', 'g.email', 'sg.relationship'];
  const guardian =
    (await trx('student_guardians as sg').join('guardians as g', 'g.id', 'sg.guardian_id').where({ 'sg.student_id': studentId, 'sg.is_primary': true, 'g.tenant_id': tenantId }).first(guardianCols)) ||
    (await trx('student_guardians as sg').join('guardians as g', 'g.id', 'sg.guardian_id').where({ 'sg.student_id': studentId, 'sg.guardian_id': g.id }).first(guardianCols));
  const enrollment = await trx('enrollments as e')
      .join('sections as sc', 'sc.id', 'e.section_id')
      .join('grades as gr', 'gr.id', 'sc.grade_id')
      .join('school_periods as sp', 'sp.id', 'sc.school_period_id')
      .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId })
      .whereNot('e.status', 'withdrawn')
      .orderBy('sp.start_date', 'desc')
      .first('gr.name as grade', 'sc.name as section');
  // Planilla anterior del alumno (otro formulario): primero las aprobadas, luego la más reciente.
  const prev = await trx('enrollment_form_submissions as s')
      .join('enrollment_forms as f', 'f.id', 's.form_id')
      .where({ 's.tenant_id': tenantId, 's.student_id': studentId })
      .whereNot('s.form_id', formId)
      .whereNotIn('s.status', ['rejected', PENDING]) // las «Por llenar» están vacías
      .orderByRaw("(s.status = 'approved') DESC, s.submitted_at DESC")
      .first('s.answers', 's.fields_snapshot', 's.guardian_id', 'f.title');
  const full = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ');
  const record = {
    'student.first_name': student?.first_name,
    'student.last_name': student?.last_name,
    'student.full_name': full(student),
    'student.national_id': student?.national_id,
    'student.birth_date': student?.birth_date,
    'student.grade': enrollment?.grade,
    'student.section': enrollment ? `${enrollment.grade} «${enrollment.section}»` : null,
    'guardian.first_name': guardian?.first_name,
    'guardian.last_name': guardian?.last_name,
    'guardian.full_name': full(guardian),
    'guardian.national_id': guardian?.national_id,
    'guardian.phone': guardian?.phone,
    'guardian.email': guardian?.email,
    'guardian.relationship': guardian?.relationship,
  };

  const answers = {};
  const sources = {};
  const prevFields = prev ? prev.fields_snapshot || [] : [];
  const keys = prefillMap(form.fields); // dato de cada pregunta, según su sección
  for (const f of form.fields) {
    if (f.type === 'section') continue;
    const key = keys[f.id];
    const fromRecord = key ? fitValue(f, record[key]) : null;
    if (fromRecord !== null) {
      answers[f.id] = fromRecord;
      sources[f.id] = 'record';
      continue;
    }
    if (!prev) continue;
    // Misma pregunta en la planilla anterior. Las casillas «acepto» se vuelven a marcar a
    // conciencia, y lo que cambia de un año a otro (grado al que aspira…) no se copia.
    if (f.type === 'checkbox' || f.prefill === 'none' || /aspira|solicita|cursara|inscrib|proximo/.test(norm(f.label))) continue;
    const same = prevFields.find((p) => p.type === f.type && p.id === f.id) || prevFields.find((p) => p.type === f.type && norm(p.label) === norm(f.label));
    if (!same) continue;
    let v = prev.answers?.[same.id];
    if (f.type === 'checkboxes') v = Array.isArray(v) ? v.filter((o) => f.options.includes(o)) : null;
    else if (f.type === 'photo') v = isPhotoName(v) && photoPath(tenantId, v) ? v : null;
    else v = fitValue(f, v);
    if (v === null || (Array.isArray(v) && !v.length)) continue;
    answers[f.id] = v;
    sources[f.id] = 'previous';
  }
  return {
    answers,
    sources,
    previous: prev ? { title: prev.title } : null,
    // De quién son los datos de representante precargados (para el aviso del portal).
    guardian: guardian ? { name: full(guardian), relationship: guardian.relationship || null, isSelf: guardian.id === g.id } : null,
  };
}

/**
 * El representante elimina (anula) una planilla suya mientras sigue en
 * revisión o devuelta para corregir: queda libre para enviar una nueva.
 * Las aprobadas o rechazadas no se pueden eliminar.
 * → { photos } fotos que ya no usa ninguna planilla (para borrarlas del disco).
 */
async function deleteOwnSubmission(trx, tenantId, userId, id) {
  const g = await guardianOf(trx, tenantId, userId);
  const s = await trx('enrollment_form_submissions as s')
    .join('enrollment_forms as f', 'f.id', 's.form_id')
    .where({ 's.tenant_id': tenantId, 's.id': id, 's.guardian_id': g.id })
    .forUpdate('s')
    .first('s.id', 's.status', 's.answers', 's.fields_snapshot', 'f.status as form_status');
  if (!s) throw ApiError.notFound('Planilla no encontrada.');
  if (!['submitted', 'changes_requested'].includes(s.status)) {
    // La «Por llenar» la asigna el colegio: no hay nada que anular.
    throw ApiError.conflict(s.status === PENDING ? 'Esta planilla aún no se ha enviado: no hay nada que eliminar.' : notOpenMessage(s.status, 'eliminar'));
  }
  if (s.form_status !== 'published') throw ApiError.conflict('El colegio ya cerró esta planilla: no se puede eliminar.');
  await trx('enrollment_form_submissions').where({ id: s.id }).delete();

  // Fotos de esta planilla que no aparecen en ninguna otra (la foto se reutiliza al re-inscribir).
  const files = (s.fields_snapshot || []).filter((f) => f.type === 'photo').map((f) => s.answers?.[f.id]).filter(isPhotoName);
  const photos = [];
  for (const file of files) {
    const { rows } = await trx.raw('SELECT 1 FROM enrollment_form_submissions x, jsonb_each_text(x.answers) a WHERE x.tenant_id = ? AND a.value = ? LIMIT 1', [tenantId, file]);
    if (!rows.length) photos.push(file);
  }
  return { photos };
}

/**
 * PDF de una planilla recibida, con membrete del colegio (logo, nombre, RIF,
 * dirección) y firmas al pie. `guardianUserId`: si lo pide un representante,
 * solo la suya. → { buffer, fileName }
 */
async function submissionPdf(trx, tenantId, id, { guardianUserId = null } = {}) {
  const s = await getSubmission(trx, tenantId, id);
  if (guardianUserId) {
    const g = await guardianOf(trx, tenantId, guardianUserId);
    if (g.id !== s.guardian_id) throw ApiError.notFound('Planilla recibida no encontrada.');
  }
  if (s.status === PENDING) throw ApiError.conflict('Esta planilla aún no se ha llenado: no hay PDF.');
  const form = await loadForm(trx, tenantId, s.form_id);
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const settings = await trx('tenant_settings').where({ tenant_id: tenantId }).first();
  const buffer = await generateEnrollmentFormPdf({
    tenant: {
      name: tenant.name,
      rif: settings?.rif || null,
      address: settings?.address || null,
      phone: settings?.contact_phone || null,
      email: settings?.contact_email || null,
      logoPath: resolveLogoFileOrDefault(settings?.logo_url),
      primaryColor: settings?.primary_color,
    },
    form: { title: form.title, schoolPeriod: form.school_period_name },
    submission: {
      id: s.id,
      status: s.status,
      submittedAt: s.submitted_at,
      reviewedAt: s.reviewed_at,
      reviewNote: s.review_note,
      studentName: s.student_name,
      isApplicant: !s.student_id,
      guardianName: s.guardian_name,
      guardianNationalId: s.guardian_national_id,
      guardianPhone: s.guardian_phone,
      guardianEmail: s.guardian_email,
      fields: s.fields_snapshot,
      answers: s.answers,
      // Foto del alumno (si la planilla tiene ese campo): esquina superior derecha.
      hasPhotoField: (s.fields_snapshot || []).some((x) => x.type === 'photo'),
      photoPath: (() => {
        const pf = (s.fields_snapshot || []).find((x) => x.type === 'photo');
        return pf ? photoPath(tenantId, s.answers?.[pf.id]) : null;
      })(),
    },
  });
  const slug = String(s.student_name || 'planilla')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return { buffer, fileName: `planilla-inscripcion-${slug || 'alumno'}.pdf` };
}

/**
 * Ruta en disco de una foto, si quien la pide puede verla: la administración
 * (la ruta ya exige el permiso) o el representante cuya planilla la contiene.
 */
async function photoFor(trx, tenantId, file, { guardianUserId = null } = {}) {
  const full = photoPath(tenantId, file);
  if (!full) throw ApiError.notFound('Foto no encontrada.');
  if (guardianUserId) {
    const g = await guardianOf(trx, tenantId, guardianUserId);
    // Sus planillas, o las de sus representados (la foto se reutiliza al re-inscribir).
    const { rows } = await trx.raw(
      `SELECT 1 FROM enrollment_form_submissions s, jsonb_each_text(s.answers) a
        WHERE s.tenant_id = ? AND a.value = ?
          AND (s.guardian_id = ? OR s.student_id IN (SELECT student_id FROM student_guardians WHERE guardian_id = ?))
        LIMIT 1`,
      [tenantId, file, g.id, g.id]
    );
    if (!rows.length) throw ApiError.notFound('Foto no encontrada.');
  }
  return full;
}

module.exports = {
  PREFILL_SOURCES,
  prefillSourceOf,
  openAfterPromotion,
  dropPendingFor,
  formForPeriod,
  PENDING,
  notOpenMessage,
  portalReminders,
  pendingEnrollments,
  prefillMap,
  sectionScopeOf,
  SECTION_SCOPES,
  norm,
  inbox,
  REVIEW_LABELS,
  prefill,
  deleteOwnSubmission,
  photoFor,
  submissionPdf,
  FIELD_TYPES,
  STARTER_FIELDS,
  normalizeFields,
  validateAnswers,
  listForms,
  loadForm,
  createForm,
  updateForm,
  setStatus,
  deleteForm,
  listSubmissions,
  getSubmission,
  reviewSubmission,
  portalOverview,
  submit,
};
