const notifications = require('./notification.service');
const sanitizeHtml = require('sanitize-html');
const { ApiError } = require('../../utils/ApiError');
const { isStoredAnnouncementImage } = require('../../services/storage/announcementImageStorage');

/**
 * Comunicados de la administración (migración 076).
 *
 * Un comunicado es UNA notificación (tabla notifications) con:
 *   - audience ['users'] y target_user_ids = los usuarios destinatarios, ya
 *     resueltos aquí según el alcance elegido (así la campana y el Centro de
 *     notificaciones lo muestran sin lógica nueva, y el trigger de 061 guarda la
 *     foto de destinatarios para el reporte de lectura);
 *   - body_html saneado con lista blanca y body en texto plano (resumen).
 *
 * Alcance (`scope`) y grupos (`groups`):
 *   school    todo el colegio
 *   levels    niveles (Inicial / Primaria / Secundaria)
 *   grades    grados
 *   sections  secciones
 *   people    personas concretas (representantes y/o personal)
 *   groups: { guardians, teachers, staff }
 *     guardians  representantes de los alumnos con inscripción vigente en el alcance
 *     teachers   docentes que atienden esas secciones (titulares, de materia) y
 *                coordinadores de esos niveles; en «todo el colegio», todo el personal docente
 *     staff      personal administrativo y de apoyo (solo «todo el colegio»)
 * Solo reciben quienes tienen usuario ACTIVO (los demás se cuentan como «sin acceso»).
 * Quien envía no se incluye.
 */

const CATEGORIES = {
  academic: 'Académico',
  administrative: 'Administrativo',
  urgent: 'Urgente',
  event: 'Evento',
};
const LEVEL_NAMES = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };
const MAX_HTML = 100000;

// ---------- Saneado del texto con formato ----------

// Colores: solo #hex y rgb()/rgba() (sin url(), expresiones ni nombres raros).
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i];
const ALIGN = [/^(left|right|center|justify)$/];
const BLOCK_STYLE = { 'text-align': ALIGN, color: COLOR, 'background-color': COLOR };

/** ¿Imagen permitida? Las subidas al colegio (/storage/announcements/…) o direcciones https. */
const imageSrcOk = (src) => isStoredAnnouncementImage(src) || /^https:\/\/[^\s"'<>]+$/i.test(String(src || ''));

const SANITIZE = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'span', 'ul', 'ol', 'li', 'a', 'blockquote', 'img'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt'],
    span: ['style'],
    p: ['style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    li: ['style'],
    blockquote: ['style'],
  },
  // Estilos permitidos: alineación, color de texto y resaltado. Nada más (ni tamaños, ni posiciones, ni url()).
  allowedStyles: { span: { color: COLOR, 'background-color': COLOR }, p: BLOCK_STYLE, h1: BLOCK_STYLE, h2: BLOCK_STYLE, h3: BLOCK_STYLE, li: BLOCK_STYLE, blockquote: BLOCK_STYLE },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https'] },
  allowProtocolRelative: false,
  transformTags: {
    b: 'strong',
    i: 'em',
    strike: 's',
    div: 'p',
    h4: 'h3',
    h5: 'h3',
    h6: 'h3',
    // <font color> (navegadores que no escriben CSS) → <span style="color">.
    font: (tagName, attribs) => ({ tagName: 'span', attribs: attribs.color ? { style: `color: ${attribs.color}` } : {} }),
    mark: (tagName, attribs) => ({ tagName: 'span', attribs: { style: attribs.style || 'background-color: #fef08a' } }),
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
  // Enlaces sin destino válido (p. ej. javascript:) e imágenes de origen no permitido se descartan.
  exclusiveFilter: (frame) => (frame.tag === 'a' && !frame.attribs.href) || (frame.tag === 'img' && !imageSrcOk(frame.attribs.src)),
};

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** HTML (ya saneado) → texto plano: un salto de línea por párrafo, viñeta por ítem. */
function toPlainText(html) {
  const marked = html
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<img[^>]*>/gi, '[Imagen] ')
    .replace(/<\/(p|li|blockquote|h1|h2|h3)>|<br\s*\/?>/gi, '\n');
  return sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeMessage(html) {
  if (String(html || '').length > MAX_HTML) throw ApiError.badRequest('El mensaje es demasiado largo.', [{ path: 'html', message: `Máximo ${MAX_HTML} caracteres con formato.` }]);
  const clean = sanitizeHtml(String(html || ''), SANITIZE).trim();
  const text = toPlainText(clean);
  // Un cartel sin texto también es un mensaje válido.
  if (text.replace(/\[Imagen\]/g, '').trim().length < 3 && !/<img\s/i.test(clean)) {
    throw ApiError.badRequest('Escribe el mensaje del comunicado.', [{ path: 'html', message: 'Mensaje vacío.' }]);
  }
  return { html: clean, text };
}

// ---------- Destinatarios ----------

/** Secciones del alcance, en años escolares abiertos (los cerrados ya no tienen alumnos vigentes). */
function sectionsInScope(trx, tenantId, { scope, levelCodes = [], gradeIds = [], sectionIds = [] }) {
  const q = trx('sections as sec')
    .join('grades as g', 'g.id', 'sec.grade_id')
    .join('school_periods as sp', 'sp.id', 'sec.school_period_id')
    .where('sec.tenant_id', tenantId)
    .whereNull('sp.closed_at');
  if (scope === 'levels') q.whereIn('g.level_code', levelCodes);
  if (scope === 'grades') q.whereIn('g.id', gradeIds);
  if (scope === 'sections') q.whereIn('sec.id', sectionIds);
  return q.select('sec.id');
}

/**
 * Resuelve los destinatarios: [{ user_id, kind: 'guardian'|'teacher'|'staff', name }]
 * y cuántos del alcance no tienen acceso (sin usuario activo).
 */
async function resolveRecipients(trx, tenantId, senderId, input) {
  const { scope, groups = {}, guardianIds = [], staffIds = [] } = input;
  const byUser = new Map();
  const withoutAccess = { guardians: 0, teachers: 0, staff: 0 };
  const add = (rows, kind, key) =>
    rows.forEach((r) => {
      if (!r.user_id || r.user_status !== 'active') {
        withoutAccess[key] += 1;
        return;
      }
      if (r.user_id === senderId || byUser.has(r.user_id)) return;
      byUser.set(r.user_id, { user_id: r.user_id, kind, name: `${r.first_name} ${r.last_name}`.trim() });
    });

  const guardianCols = ['g.id', 'g.first_name', 'g.last_name', 'g.user_id', 'u.status as user_status'];
  const staffCols = ['s.id', 's.first_name', 's.last_name', 's.user_id', 'u.status as user_status'];

  if (scope === 'people') {
    if (guardianIds.length) {
      const rows = await trx('guardians as g').leftJoin('users as u', 'u.id', 'g.user_id').where('g.tenant_id', tenantId).whereIn('g.id', guardianIds).select(guardianCols);
      if (rows.length !== new Set(guardianIds).size) throw ApiError.badRequest('Hay representantes que no pertenecen al colegio.', [{ path: 'guardianIds', message: 'Representante inválido.' }]);
      add(rows, 'guardian', 'guardians');
    }
    if (staffIds.length) {
      const rows = await trx('staff as s').leftJoin('users as u', 'u.id', 's.user_id').where('s.tenant_id', tenantId).whereIn('s.id', staffIds).select(staffCols);
      if (rows.length !== new Set(staffIds).size) throw ApiError.badRequest('Hay personas del personal que no pertenecen al colegio.', [{ path: 'staffIds', message: 'Persona inválida.' }]);
      add(rows, 'teacher', 'teachers');
    }
    return { recipients: [...byUser.values()], withoutAccess };
  }

  const sections = scope === 'school' ? null : sectionsInScope(trx, tenantId, input);

  if (groups.guardians) {
    const q = trx('guardians as g').leftJoin('users as u', 'u.id', 'g.user_id').where('g.tenant_id', tenantId).distinct(guardianCols);
    if (sections) {
      q.whereExists(
        trx('student_guardians as sg')
          .join('enrollments as e', 'e.student_id', 'sg.student_id')
          .whereRaw('sg.guardian_id = g.id')
          .where('e.status', 'active')
          .whereIn('e.section_id', sections)
      );
    }
    add(await q, 'guardian', 'guardians');
  }

  if (groups.teachers) {
    const q = trx('staff as s').leftJoin('users as u', 'u.id', 's.user_id').where({ 's.tenant_id': tenantId, 's.status': 'active' }).distinct(staffCols);
    if (sections) {
      q.where((w) =>
        w
          .whereIn('s.id', trx('teacher_sections').whereIn('section_id', sections).select('staff_id'))
          .orWhereIn('s.id', trx('teacher_subject_sections').whereIn('section_id', sections).select('staff_id'))
          // Coordinadores de los niveles del alcance.
          .orWhereIn(
            's.coordination_level',
            trx('sections as sec2').join('grades as g2', 'g2.id', 'sec2.grade_id').whereIn('sec2.id', sections).distinct('g2.level_code')
          )
      );
    } else {
      q.whereIn('s.staff_type', ['teaching', 'coordinator']);
    }
    add(await q, 'teacher', 'teachers');
  }

  if (groups.staff && scope === 'school') {
    const rows = await trx('staff as s')
      .leftJoin('users as u', 'u.id', 's.user_id')
      .where({ 's.tenant_id': tenantId, 's.status': 'active' })
      .whereNotIn('s.staff_type', ['teaching', 'coordinator'])
      .select(staffCols);
    add(rows, 'staff', 'staff');
  }

  return { recipients: [...byUser.values()], withoutAccess };
}

/** Descripción legible del alcance: «Todo el colegio», «Primaria, Secundaria», «1er Grado A»… */
async function scopeLabel(trx, tenantId, input) {
  const groupsText = [input.groups?.guardians && 'representantes', input.groups?.teachers && 'docentes', input.groups?.staff && input.scope === 'school' && 'personal administrativo']
    .filter(Boolean)
    .join(', ');
  const who = groupsText ? ` · ${groupsText}` : '';
  if (input.scope === 'school') return `Todo el colegio${who}`;
  if (input.scope === 'levels') return `${input.levelCodes.map((c) => LEVEL_NAMES[c] || c).join(', ')}${who}`;
  if (input.scope === 'grades') {
    const names = await trx('grades').where({ tenant_id: tenantId }).whereIn('id', input.gradeIds).orderBy('sort_order').pluck('name');
    return `${names.join(', ')}${who}`;
  }
  if (input.scope === 'sections') {
    const rows = await trx('sections as s').join('grades as g', 'g.id', 's.grade_id').where('s.tenant_id', tenantId).whereIn('s.id', input.sectionIds).orderBy(['g.sort_order', 's.name']).select('g.name as grade', 's.name');
    return `${rows.map((r) => `${r.grade} ${r.name}`).join(', ')}${who}`;
  }
  const n = (input.guardianIds?.length || 0) + (input.staffIds?.length || 0);
  return `${n} destinatario${n === 1 ? '' : 's'} elegido${n === 1 ? '' : 's'}`;
}

function assertScope(input) {
  const need = { levels: 'levelCodes', grades: 'gradeIds', sections: 'sectionIds' }[input.scope];
  if (need && !(input[need] || []).length) {
    throw ApiError.badRequest('Elige al menos un elemento del alcance.', [{ path: need, message: 'Requerido.' }]);
  }
  if (input.scope === 'people' && !(input.guardianIds?.length || input.staffIds?.length)) {
    throw ApiError.badRequest('Elige al menos un destinatario.', [{ path: 'people', message: 'Requerido.' }]);
  }
  if (input.scope !== 'people' && !Object.values(input.groups || {}).some(Boolean)) {
    throw ApiError.badRequest('Elige a quién va dirigido: representantes, docentes o personal.', [{ path: 'groups', message: 'Requerido.' }]);
  }
}

/** Vista previa del alcance: cuántos lo recibirán, por grupo, y cuántos no tienen acceso. */
async function preview(trx, tenantId, senderId, input) {
  assertScope(input);
  const { recipients, withoutAccess } = await resolveRecipients(trx, tenantId, senderId, input);
  const by = (kind) => recipients.filter((r) => r.kind === kind).length;
  return {
    total: recipients.length,
    by_group: { guardians: by('guardian'), teachers: by('teacher'), staff: by('staff') },
    without_access: withoutAccess,
    scope_label: await scopeLabel(trx, tenantId, input),
    sample: recipients.slice(0, 6).map((r) => r.name),
  };
}

/** Envía el comunicado: una notificación con sus destinatarios. */
async function send(trx, tenantId, sender, input) {
  assertScope(input);
  const { html, text } = sanitizeMessage(input.html);
  const { recipients } = await resolveRecipients(trx, tenantId, sender.id, input);
  if (!recipients.length) {
    throw ApiError.unprocessable('Nadie del alcance elegido tiene acceso al sistema: el comunicado no tendría destinatarios.');
  }
  const label = await scopeLabel(trx, tenantId, input);
  const [row] = await trx('notifications')
    .insert({
      tenant_id: tenantId,
      type: 'announcement',
      title: input.title.trim(),
      body: text.length > 500 ? `${text.slice(0, 497)}…` : text,
      body_html: html,
      category: input.category,
      created_by: sender.id,
      audience: ['users'],
      target_user_ids: recipients.map((r) => r.user_id),
      data: JSON.stringify({ category: input.category, category_label: CATEGORIES[input.category], scope_label: label, sender_name: sender.name, recipients: recipients.length }),
    })
    .returning(['id', 'created_at']);
  return { id: row.id, created_at: row.created_at, recipients: recipients.length, scope_label: label };
}

/** Comunicados enviados, con cuántos lo recibieron y cuántos ya lo leyeron. */
async function listSent(trx, tenantId, { limit = 50 } = {}) {
  const rows = await trx('notifications as n')
    .leftJoin('users as u', 'u.id', 'n.created_by')
    .where({ 'n.tenant_id': tenantId, 'n.type': 'announcement' })
    .select(
      'n.id',
      'n.title',
      'n.body',
      'n.body_html',
      'n.category',
      'n.data',
      'n.created_at',
      'u.full_name as sender_name',
      trx.raw('(SELECT count(*)::int FROM notification_recipients nr WHERE nr.notification_id = n.id) AS recipients'),
      trx.raw('(SELECT count(*)::int FROM notification_reads r JOIN notification_recipients nr ON nr.notification_id = r.notification_id AND nr.user_id = r.user_id WHERE r.notification_id = n.id) AS reads')
    )
    .orderBy('n.created_at', 'desc')
    .limit(limit);
  return rows.map((r) => ({ ...r, scope_label: r.data?.scope_label || null, category_label: CATEGORIES[r.category] || null }));
}

/**
 * Log de lectura de UN comunicado (el contador «1/5 leído» del historial): los
 * destinatarios con su estado, la hora de lectura y su sección o área. Solo
 * comunicados: los demás avisos se auditan desde el Log de notificaciones.
 */
async function readLog(trx, tenantId, id) {
  const n = await trx('notifications').where({ id, tenant_id: tenantId, type: 'announcement' }).first('id');
  if (!n) throw ApiError.notFound('Comunicado no encontrado.');
  return notifications.readAudit(trx, tenantId, id);
}

/** Opciones del formulario: grados y secciones de los años abiertos, representantes y personal con acceso. */
async function options(trx, tenantId) {
  const grades = await trx('grades as g')
    .where('g.tenant_id', tenantId)
    .whereExists(trx('sections as s').join('school_periods as sp', 'sp.id', 's.school_period_id').whereRaw('s.grade_id = g.id').whereNull('sp.closed_at'))
    .orderBy(['g.sort_order', 'g.name'])
    .select('g.id', 'g.name', 'g.level_code');
  const sections = await trx('sections as s')
    .join('grades as g', 'g.id', 's.grade_id')
    .join('school_periods as sp', 'sp.id', 's.school_period_id')
    .where('s.tenant_id', tenantId)
    .whereNull('sp.closed_at')
    .orderBy(['sp.start_date', 'g.sort_order', 's.name'])
    .select('s.id', 's.name', 'g.id as grade_id', 'g.name as grade_name', 'g.level_code', 'sp.name as school_period_name');
  const guardians = await trx('guardians as g')
    .join('users as u', 'u.id', 'g.user_id')
    .where({ 'g.tenant_id': tenantId, 'u.status': 'active' })
    .orderBy(['g.first_name', 'g.last_name'])
    .select('g.id', 'g.first_name', 'g.last_name', 'g.national_id', 'g.email');
  const staff = await trx('staff as s')
    .join('users as u', 'u.id', 's.user_id')
    .where({ 's.tenant_id': tenantId, 's.status': 'active', 'u.status': 'active' })
    .orderBy(['s.first_name', 's.last_name'])
    .select('s.id', 's.first_name', 's.last_name', 's.staff_type', 's.email');
  return { categories: CATEGORIES, levels: LEVEL_NAMES, grades, sections, guardians, staff };
}

module.exports = { CATEGORIES, sanitizeMessage, toPlainText, resolveRecipients, preview, send, listSent, options, readLog };
