const fs = require('fs/promises');
const { ApiError } = require('../../utils/ApiError');
const storage = require('../../services/storage/certificateStorage');
const { generateCertificates, inspectBackground, mergeInOrder } = require('../../services/pdf/certificateGenerator');
const standard = require('../../services/pdf/standardCertificates');
const { publicList: fontList } = require('../../services/pdf/certificateFonts');
const { resolveLogoFile, toPublicUrl } = require('../../services/storage/logoStorage');
const { currentPeriodOrder } = require('../../utils/schoolPeriods');

/**
 * Certificado de promoción de cada colegio (migraciones 091 y 093).
 *
 * Un colegio puede tener varios diseños, cada uno con su ALCANCE:
 *   { schoolPeriodId, levelCode }   null = todos los años / todos los niveles
 * Al emitir, se usa el más específico para el año y el nivel del alumno:
 *   año y nivel → año, todos los niveles → nivel, todos los años → general.
 *
 * El colegio siempre es el de la sesión (`tenantId`), nunca un parámetro: así nadie
 * puede pedir los diseños o los datos de otro colegio.
 */

const VARIABLES = ['student_name', 'student_id', 'target_grade', 'school_year', 'issue_date'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const longDate = (d = new Date()) => `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GENERAL = { schoolPeriodId: null, levelCode: null };

/** El tipo se decide por la firma del archivo, no por su nombre ni por lo que declare el navegador. */
function detectType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

const publicRow = (row) => (row ? { ...row, page_width: Number(row.page_width), page_height: Number(row.page_height) } : null);

/** Dos clics casi a la vez: el segundo choca con el índice único. Mensaje claro en vez de un error técnico. */
async function insertDesign(trx, row) {
  try {
    await trx.transaction((sp) => sp('certificate_templates').insert(row));
  } catch (err) {
    if (err.code === '23505') throw ApiError.conflict('Este nivel y año ya tienen su diseño propio: recarga la página para verlo.');
    throw err;
  }
}

/** El diseño propio de ese alcance (no el que hereda), o null. */
function loadExact(trx, tenantId, { schoolPeriodId, levelCode }) {
  return trx('certificate_templates')
    .where({ tenant_id: tenantId })
    .modify((q) => (schoolPeriodId ? q.where('school_period_id', schoolPeriodId) : q.whereNull('school_period_id')))
    .modify((q) => (levelCode ? q.where('level_code', levelCode) : q.whereNull('level_code')))
    .first();
}

/** El diseño que se usa para un año y un nivel: el más específico que exista. */
function resolveFor(trx, tenantId, schoolPeriodId, levelCode) {
  return trx('certificate_templates')
    .where({ tenant_id: tenantId })
    .whereRaw('(school_period_id IS NULL OR school_period_id = ?)', [schoolPeriodId || null])
    .whereRaw('(level_code IS NULL OR level_code = ?)', [levelCode || null])
    .orderByRaw('(school_period_id IS NULL), (level_code IS NULL)')
    .first();
}

/** Se puede emitir: tiene algo colocado y su archivo de fondo existe. */
const usable = (tenantId, row) => Boolean(row?.fields?.length && storage.resolveBackground(tenantId, row.background_path));

async function scopeNames(trx, tenantId) {
  const periods = await trx('school_periods').where({ tenant_id: tenantId }).orderBy('start_date', 'desc').select('id', 'name', 'closed_at');
  const levels = await trx('education_levels').orderBy('sort_order').select('code', 'name');
  return { periods, levels };
}

/** «Educación Primaria · 2026-2027», «Todos los niveles · 2026-2027», «General»… */
function labelOf(names, schoolPeriodId, levelCode) {
  if (!schoolPeriodId && !levelCode) return 'General';
  const level = levelCode ? names.levels.find((l) => l.code === levelCode)?.name || levelCode : 'Todos los niveles';
  const year = schoolPeriodId ? names.periods.find((p) => p.id === schoolPeriodId)?.name || 'año eliminado' : 'todos los años';
  return `${level} · ${year}`;
}

/** El alcance pedido debe ser de este colegio y de un nivel existente. */
async function checkScope(trx, tenantId, scope) {
  if (scope.schoolPeriodId) {
    const p = await trx('school_periods').where({ id: scope.schoolPeriodId, tenant_id: tenantId }).first('id');
    if (!p) throw ApiError.badRequest('Año escolar inválido.', [{ path: 'schoolPeriodId', message: 'Año escolar inválido.' }]);
  }
  if (scope.levelCode) {
    const l = await trx('education_levels').where({ code: scope.levelCode }).first('code');
    if (!l) throw ApiError.badRequest('Nivel educativo inválido.', [{ path: 'levelCode', message: 'Nivel inválido.' }]);
  }
}

async function requireExact(trx, tenantId, scope, message = 'Este nivel y año aún no tienen un diseño propio: créalo o sube su fondo.') {
  await checkScope(trx, tenantId, scope);
  const row = await loadExact(trx, tenantId, scope);
  if (!row) throw ApiError.conflict(message);
  return row;
}

async function readBackground(tenantId, row) {
  const full = storage.resolveBackground(tenantId, row.background_path);
  if (!full) throw ApiError.conflict('No se encontró el fondo del certificado: vuelve a subirlo.');
  return { full, buffer: await fs.readFile(full), type: row.background_type };
}

/**
 * Lo que necesita el editor para un alcance: su diseño propio (`template`), el que
 * usaría si no tiene (`effective`), los años y niveles, y todos los diseños del colegio.
 */
async function getTemplate(trx, tenantId, scope = GENERAL) {
  await checkScope(trx, tenantId, scope);
  const logo = await schoolLogo(trx, tenantId);
  const year = await publishYear(trx, tenantId, scope);
  const names = await scopeNames(trx, tenantId);
  const template = await loadExact(trx, tenantId, scope);
  const effective = template || (await resolveFor(trx, tenantId, scope.schoolPeriodId, scope.levelCode));
  const rows = await trx('certificate_templates').where({ tenant_id: tenantId }).select('id', 'school_period_id', 'level_code', 'published_at', 'fields', 'background_path');
  const designs = rows
    .map((r) => ({
      id: r.id,
      school_period_id: r.school_period_id,
      level_code: r.level_code,
      label: labelOf(names, r.school_period_id, r.level_code),
      published: Boolean(r.published_at),
      ready: usable(tenantId, r),
    }))
    .sort((a, b) => Number(Boolean(a.school_period_id)) - Number(Boolean(b.school_period_id)) || Number(Boolean(a.level_code)) - Number(Boolean(b.level_code)) || a.label.localeCompare(b.label, 'es'));
  return {
    scope,
    scope_label: labelOf(names, scope.schoolPeriodId, scope.levelCode),
    template: publicRow(template),
    effective: publicRow(effective),
    effective_label: effective ? labelOf(names, effective.school_period_id, effective.level_code) : null,
    designs,
    periods: names.periods,
    levels: names.levels,
    variables: VARIABLES,
    fonts: fontList(),
    standard_templates: standard.standardList(),
    // El logo que saldrá en el PDF (Configuración → Apariencia), o null si el colegio no tiene.
    logo_url: logo ? toPublicUrl(logo.stored) : null,
    // El año que mira la publicación: si sigue activo, publicar pide confirmación.
    publish_year: year ? { id: year.id, name: year.name, active: !year.closed_at, all_years: !scope.schoolPeriodId } : null,
  };
}

/**
 * Sube o reemplaza el fondo de ese alcance. Si aún no tenía diseño propio, nace con
 * las posiciones del que heredaba. NO borra ningún archivo: la transacción aún se
 * puede revertir. Devuelve `created` y `previous` para limpiar al terminar
 * (settleBackgroundFiles en las rutas).
 */
async function saveBackground(trx, tenantId, userId, scope, buffer) {
  await checkScope(trx, tenantId, scope);
  const type = detectType(buffer);
  if (!type) throw ApiError.badRequest('El fondo debe ser una imagen PNG o JPG, o un PDF.', [{ path: 'background', message: 'Formato no permitido.' }]);
  let size;
  try {
    size = await inspectBackground(buffer, type);
  } catch {
    throw ApiError.badRequest(type === 'pdf' ? 'No se pudo leer el PDF: puede estar dañado o protegido con contraseña.' : 'No se pudo leer la imagen: puede estar dañada.', [{ path: 'background', message: 'Archivo no válido.' }]);
  }
  const previous = await loadExact(trx, tenantId, scope);
  const inherited = previous ? null : await resolveFor(trx, tenantId, scope.schoolPeriodId, scope.levelCode);
  const name = await storage.saveBackground(tenantId, buffer, type);
  const values = { background_path: name, background_type: type, page_width: size.width, page_height: size.height, updated_by: userId, updated_at: trx.fn.now() };
  if (previous) await trx('certificate_templates').where({ id: previous.id }).update(values);
  else {
    await insertDesign(trx, {
      tenant_id: tenantId,
      school_period_id: scope.schoolPeriodId,
      level_code: scope.levelCode,
      fields: JSON.stringify(inherited?.fields || []),
      ...values,
    });
  }
  return { template: publicRow(await loadExact(trx, tenantId, scope)), pages: size.pages || 1, created: name, previous: previous?.background_path || null };
}

/** Color principal del colegio, para teñir las plantillas estándar. */
async function brandColor(trx, tenantId) {
  return (await trx('tenant_settings').where({ tenant_id: tenantId }).first('primary_color'))?.primary_color || null;
}

/** Fondo de una plantilla estándar con el color del colegio (vista previa de la galería). */
async function standardPreview(trx, tenantId, key) {
  if (!standard.STANDARD_KEYS.includes(key)) throw ApiError.notFound('Plantilla estándar no encontrada.');
  return { buffer: await standard.standardBackground(key, await brandColor(trx, tenantId)), fileName: `plantilla-${key}.pdf` };
}

/**
 * Usa una plantilla estándar como fondo de ese alcance (crea su diseño propio si no
 * lo tenía). Si el diseño queda sin nada colocado, recibe la distribución sugerida de
 * la plantilla; si ya tenía textos, se conservan. → como saveBackground, + `suggested`.
 */
async function applyStandard(trx, tenantId, userId, scope, key) {
  if (!standard.STANDARD_KEYS.includes(key)) throw ApiError.notFound('Plantilla estándar no encontrada.');
  const color = await brandColor(trx, tenantId);
  // Sin diseño propio (o sin textos propios) la plantilla llega con su distribución,
  // no con los textos heredados de otro diseño.
  const own = await loadExact(trx, tenantId, scope);
  const result = await saveBackground(trx, tenantId, userId, scope, await standard.standardBackground(key, color));
  let suggested = false;
  if (!own?.fields?.length) {
    await trx('certificate_templates').where({ id: result.template.id }).update({ fields: JSON.stringify(standard.standardFields(key, color)) });
    suggested = true;
  }
  return { ...result, template: publicRow(await loadExact(trx, tenantId, scope)), suggested };
}

/**
 * Crea el diseño propio de ese alcance copiando el que hereda (fondo y posiciones),
 * para modificarlo sin tocar el original. Nace sin publicar. → { template, created }
 */
async function customize(trx, tenantId, userId, scope) {
  await checkScope(trx, tenantId, scope);
  if (await loadExact(trx, tenantId, scope)) throw ApiError.conflict('Este nivel y año ya tienen su diseño propio.');
  const source = await resolveFor(trx, tenantId, scope.schoolPeriodId, scope.levelCode);
  if (!source) throw ApiError.conflict('No hay ningún diseño que copiar: sube el fondo de este certificado.');
  const created = await storage.copyBackground(tenantId, source.background_path);
  if (!created) throw ApiError.conflict('No se encontró el fondo del diseño que se iba a copiar: sube uno nuevo.');
  await insertDesign(trx, {
    tenant_id: tenantId,
    school_period_id: scope.schoolPeriodId,
    level_code: scope.levelCode,
    background_path: created,
    background_type: source.background_type,
    page_width: source.page_width,
    page_height: source.page_height,
    fields: JSON.stringify(source.fields || []),
    updated_by: userId,
  });
  return { template: publicRow(await loadExact(trx, tenantId, scope)), created };
}

/** Elimina el diseño propio de ese alcance: vuelve a usar el que hereda. → { previous } para borrar su archivo. */
async function removeDesign(trx, tenantId, scope) {
  const row = await requireExact(trx, tenantId, scope, 'Este nivel y año no tienen un diseño propio que eliminar.');
  await trx('certificate_templates').where({ id: row.id }).delete();
  return { previous: row.background_path };
}

async function saveFields(trx, tenantId, userId, scope, fields) {
  const row = await requireExact(trx, tenantId, scope, 'Sube primero el fondo del certificado.');
  await trx('certificate_templates').where({ id: row.id }).update({ fields: JSON.stringify(fields), updated_by: userId, updated_at: trx.fn.now() });
  return publicRow(await loadExact(trx, tenantId, scope));
}

/** El fondo que se ve en el editor: el propio o el que hereda. */
async function backgroundFile(trx, tenantId, scope) {
  await checkScope(trx, tenantId, scope);
  const row = (await loadExact(trx, tenantId, scope)) || (await resolveFor(trx, tenantId, scope.schoolPeriodId, scope.levelCode));
  if (!row) throw ApiError.notFound('Aún no hay un fondo de certificado.');
  const full = storage.resolveBackground(tenantId, row.background_path);
  if (!full) throw ApiError.notFound('No se encontró el archivo del fondo: vuelve a subirlo con «Cambiar fondo».');
  return { full, type: row.background_type };
}

/**
 * El logo propio del colegio, si lo subió y su archivo existe. Sin logo propio el
 * certificado no lleva ninguno: un documento oficial no lleva el de MoDo Educa.
 */
async function schoolLogo(trx, tenantId) {
  const stored = (await trx('tenant_settings').where({ tenant_id: tenantId }).first('logo_url'))?.logo_url;
  const full = resolveLogoFile(stored);
  return full ? { stored, full } : null;
}

/** Lee el logo para el PDF; el tipo por su firma (los logos se validan al subirlos: PNG o JPG). */
async function readLogo(trx, tenantId) {
  const logo = await schoolLogo(trx, tenantId);
  if (!logo) return null;
  try {
    const buffer = await fs.readFile(logo.full);
    if (buffer.subarray(0, 8).equals(PNG)) return { buffer, type: 'png' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return { buffer, type: 'jpg' };
  } catch {
    // Sin poder leerlo, el certificado sale igual, sin logo.
  }
  return null;
}

/** Un PDF con una página por cada juego de valores, con ese diseño. */
async function render(trx, tenantId, row, fields, pages) {
  const background = await readBackground(tenantId, row);
  const tenant = await trx('tenants').where({ id: tenantId }).first('name');
  const logo = fields.some((f) => f.type === 'logo') ? await readLogo(trx, tenantId) : null;
  return generateCertificates({ background, width: Number(row.page_width), height: Number(row.page_height), fields, pages, logo, author: tenant?.name || '' });
}

/** Vista previa con datos de ejemplo y las posiciones aún sin guardar. */
async function previewPdf(trx, tenantId, scope, fields) {
  const row = await requireExact(trx, tenantId, scope, 'Sube primero el fondo del certificado.');
  const year = scope.schoolPeriodId ? (await trx('school_periods').where({ id: scope.schoolPeriodId }).first('name'))?.name : null;
  const buffer = await render(trx, tenantId, row, fields, [
    {
      student_name: 'María Fernanda Pérez González',
      student_id: 'V-30123456',
      target_grade: '2do Grado',
      school_year: year || '2026-2027',
      issue_date: longDate(),
    },
  ]);
  return { buffer, fileName: 'certificado-ejemplo.pdf' };
}

/** Matrículas con derecho a certificado (promovido o egresado), con sus datos, de este colegio. */
function issuableQuery(trx, tenantId) {
  return trx('enrollments as e')
    .join('students as s', 's.id', 'e.student_id')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('education_levels as el', 'el.code', 'g.level_code')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .leftJoin('enrollments as ne', 'ne.id', 'e.next_enrollment_id')
    .leftJoin('sections as nsec', 'nsec.id', 'ne.section_id')
    .leftJoin('grades as ng', 'ng.id', 'nsec.grade_id')
    .where('e.tenant_id', tenantId)
    .whereIn('e.status', ['promoted', 'graduated'])
    .select('e.id', 'e.status', 's.first_name', 's.last_name', 's.national_id', 'sp.id as period_id', 'sp.name as year_name', 'g.level_code', 'el.name as level_name', 'ng.name as target_grade');
}

const fullName = (r) => `${r.first_name} ${r.last_name}`;
const valuesFor = (r, today) => ({
  student_name: fullName(r),
  student_id: r.national_id || '',
  target_grade: r.status === 'graduated' ? 'Egresado' : r.target_grade || '',
  school_year: r.year_name,
  issue_date: today,
});

/** El diseño de cada matrícula (en caché por año y nivel); error claro si alguno no se puede emitir. */
async function templatesFor(trx, tenantId, rows, { requirePublished = false } = {}) {
  const cache = new Map();
  const missing = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.period_id}|${r.level_code}`;
    if (!cache.has(key)) cache.set(key, await resolveFor(trx, tenantId, r.period_id, r.level_code));
    const t = cache.get(key);
    if (!usable(tenantId, t) || (requirePublished && !t.published_at)) missing.add(`${r.level_name} · ${r.year_name}`);
    out.push(t);
  }
  if (missing.size) {
    if (requirePublished) throw ApiError.notFound('El colegio aún no ha publicado el certificado.');
    throw ApiError.conflict(`Falta un certificado listo para ${[...missing].join(', ')}: complétalo en Administración → Certificado de promoción.`);
  }
  return out;
}

/**
 * Certificado real de un alumno: la matrícula indicada o, sin indicar, la más
 * reciente en la que fue promovido o egresó. `requirePublished`: para el portal.
 */
async function studentPdf(trx, tenantId, studentId, { enrollmentId = null, requirePublished = false } = {}) {
  const student = await trx('students').where({ id: studentId, tenant_id: tenantId }).first('id');
  if (!student) throw ApiError.notFound('Alumno no encontrado.');
  const enrollment = await issuableQuery(trx, tenantId)
    .where('e.student_id', studentId)
    .modify((q) => enrollmentId && q.where('e.id', enrollmentId))
    .orderByRaw('sp.start_date DESC NULLS LAST, e.closed_at DESC')
    .first();
  if (!enrollment) throw ApiError.conflict('Este alumno no tiene una promoción registrada: el certificado se emite al promoverlo o al egresar.');
  const [row] = await templatesFor(trx, tenantId, [enrollment], { requirePublished });
  const buffer = await render(trx, tenantId, row, row.fields, [valuesFor(enrollment, longDate())]);
  const slug = fullName(enrollment).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { buffer, fileName: `certificado-promocion-${slug || 'alumno'}.pdf` };
}

/**
 * Varios certificados en un solo PDF, una página por alumno, ordenados por nivel,
 * grado, sección y apellido; cada uno con el diseño de su año y su nivel. Se ignoran
 * las matrículas sin derecho (repitientes) y las de otro colegio.
 */
async function batchPdf(trx, tenantId, enrollmentIds) {
  const rows = await issuableQuery(trx, tenantId)
    .whereIn('e.id', enrollmentIds)
    .orderBy([{ column: 'el.sort_order' }, { column: 'g.sort_order' }, { column: 'sec.name' }, { column: 's.last_name' }, { column: 's.first_name' }]);
  if (!rows.length) throw ApiError.conflict('Ninguno de esos alumnos fue promovido ni egresó: no hay certificados que emitir.');
  const templates = await templatesFor(trx, tenantId, rows);
  const today = longDate();
  // Un PDF por diseño (el fondo se incrusta una vez) y luego, en el orden de la lista.
  const groups = new Map();
  rows.forEach((r, i) => {
    const t = templates[i];
    if (!groups.has(t.id)) groups.set(t.id, { template: t, rows: [], indices: [] });
    groups.get(t.id).rows.push(r);
    groups.get(t.id).indices.push(i);
  });
  const parts = [];
  for (const g of groups.values()) {
    parts.push({ buffer: await render(trx, tenantId, g.template, g.template.fields, g.rows.map((r) => valuesFor(r, today))), indices: g.indices });
  }
  const buffer = parts.length === 1 ? parts[0].buffer : await mergeInOrder(parts, rows.length);
  return { buffer, fileName: 'certificados-promocion.pdf', count: rows.length };
}

/** De estas matrículas del alumno, cuáles tienen certificado publicado (para el portal). */
async function publishedEnrollmentIds(trx, tenantId, studentId) {
  const rows = await issuableQuery(trx, tenantId).where('e.student_id', studentId);
  const ids = [];
  for (const r of rows) {
    const t = await resolveFor(trx, tenantId, r.period_id, r.level_code);
    if (t?.published_at && usable(tenantId, t)) ids.push(r.id);
  }
  return ids;
}

/**
 * Certificados de UN alumno para el portal, de todos sus años (el más reciente
 * primero): cada matrícula en que fue promovido o egresó, y si su diseño (el de
 * su año y su nivel) está publicado. → { certificates, unpublished, current }
 *   certificates  [{ enrollment_id, school_year, grade_name, target_grade, status }]
 *   unpublished   años con derecho a certificado cuyo diseño aún no se publicó
 *   current       { grade_name, school_year } de lo que cursa ahora, si cursa
 */
async function studentCertificates(trx, tenantId, studentId) {
  const rows = await issuableQuery(trx, tenantId)
    .where('e.student_id', studentId)
    .select('g.name as grade_name')
    .orderByRaw('sp.start_date DESC NULLS LAST');
  const certificates = [];
  const unpublished = [];
  for (const r of rows) {
    const t = await resolveFor(trx, tenantId, r.period_id, r.level_code);
    if (t?.published_at && usable(tenantId, t)) {
      certificates.push({ enrollment_id: r.id, school_year: r.year_name, grade_name: r.grade_name, target_grade: r.status === 'graduated' ? 'Egresado' : r.target_grade || null, status: r.status });
    } else unpublished.push(r.year_name);
  }
  const current = await trx('enrollments as e')
    .join('sections as sec', 'sec.id', 'e.section_id')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where({ 'e.tenant_id': tenantId, 'e.student_id': studentId, 'e.status': 'active' })
    .orderByRaw('sp.is_active DESC, sp.start_date DESC NULLS LAST')
    .first('g.name as grade_name', 'sp.name as school_year');
  return { certificates, unpublished, current: current || null };
}

/** ¿El colegio tiene algún diseño listo? */
async function isReady(trx, tenantId) {
  const rows = await trx('certificate_templates').where({ tenant_id: tenantId });
  return rows.some((r) => usable(tenantId, r));
}

/** Publica o retira del portal el diseño de ese alcance. Solo se publica lo ya guardado y completo. */
/**
 * El año escolar al que apunta la publicación de un diseño: el suyo o, si es de
 * todos los años (General o por nivel), el año en curso. Activo = no cerrado.
 */
function publishYear(trx, tenantId, scope) {
  const q = trx('school_periods').where({ tenant_id: tenantId });
  return (scope.schoolPeriodId ? q.where({ id: scope.schoolPeriodId }) : q.orderByRaw(currentPeriodOrder())).first('id', 'name', 'closed_at');
}

/**
 * PUT /certificate-template/publish. Publicar con el año escolar aún activo no se
 * bloquea, pero exige `confirmActiveYear`: sin ella responde 409 con
 * details [{ code: 'SCHOOL_YEAR_ACTIVE', ... }] para que la pantalla lo pregunte.
 * Retirar del portal nunca pide confirmación.
 */
async function setPublished(trx, tenantId, userId, scope, published, { confirmActiveYear = false } = {}) {
  const row = await requireExact(trx, tenantId, scope, 'Sube primero el fondo del certificado.');
  if (published && !usable(tenantId, row)) throw ApiError.conflict('Coloca y guarda al menos un elemento, con su fondo, antes de publicar el certificado.');
  if (published && !row.published_at && !confirmActiveYear) {
    const year = await publishYear(trx, tenantId, scope);
    if (year && !year.closed_at) {
      throw ApiError.conflict(`El año escolar ${year.name} aún se encuentra activo. Por lo general, los certificados de promoción se publican al finalizar el período.`, [
        { code: 'SCHOOL_YEAR_ACTIVE', school_period_id: year.id, name: year.name, all_years: !scope.schoolPeriodId },
      ]);
    }
  }
  await trx('certificate_templates')
    .where({ id: row.id })
    .update(published ? { published_at: trx.fn.now(), published_by: userId } : { published_at: null, published_by: null });
  return publicRow(await loadExact(trx, tenantId, scope));
}

module.exports = {
  studentCertificates,
  VARIABLES,
  GENERAL,
  getTemplate,
  saveBackground,
  customize,
  applyStandard,
  standardPreview,
  removeDesign,
  saveFields,
  backgroundFile,
  previewPdf,
  studentPdf,
  batchPdf,
  publishedEnrollmentIds,
  isReady,
  setPublished,
  resolveFor,
};
