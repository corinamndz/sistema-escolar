const { ApiError } = require('../../utils/ApiError');

/**
 * Soporte técnico: tickets del colegio hacia la plataforma.
 *
 * Los tickets viven en la tabla GLOBAL `platform.support_tickets` (la crea la
 * migración 004 del Tenant Manager, ../admin-modo-educa): el superadmin los ve
 * todos desde su panel. Aquí, el Administrador del colegio solo crea, lee y
 * responde los de SU colegio: cada consulta filtra por tenant_id (esa tabla no
 * tiene RLS por colegio).
 *
 * Corre en la transacción de la petición (req.db): crear el ticket y su primer
 * mensaje es atómico.
 */

const CATEGORIES = {
  bug: 'Falla del sistema',
  access: 'Acceso y usuarios',
  payments: 'Pagos y tasas',
  academic: 'Académico y calificaciones',
  notifications: 'Notificaciones y correos',
  data: 'Datos e importaciones',
  suggestion: 'Sugerencia o mejora',
  other: 'Otro',
};
const PRIORITIES = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const STATUSES = { open: 'Abierto', in_progress: 'En progreso', resolved: 'Resuelto', closed: 'Cerrado' };
const TICKETS = 'platform.support_tickets';
const MESSAGES = 'platform.support_ticket_messages';

let available = null;
/** ¿Existe la tabla? Sin la migración del Tenant Manager el soporte responde 503 con la indicación. */
async function assertAvailable(trx) {
  if (available) return;
  const { rows } = await trx.raw("SELECT to_regclass('platform.support_tickets') IS NOT NULL AS ok");
  available = rows[0].ok;
  if (!available) {
    available = null;
    throw new ApiError(503, 'El soporte técnico aún no está habilitado en este servidor (falta la migración 004 del Tenant Manager).');
  }
}

/** Tipo real del adjunto por su firma binaria (no por la extensión ni el mimetype del navegador). */
function sniffAttachment(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const code = (n) => `SOP-${String(n).padStart(6, '0')}`;
const shape = (t) => ({
  id: t.id,
  code: code(t.number),
  category: t.category,
  category_label: CATEGORIES[t.category] || t.category,
  priority: t.priority,
  priority_label: PRIORITIES[t.priority],
  subject: t.subject,
  description: t.description,
  status: t.status,
  status_label: STATUSES[t.status],
  page_url: t.page_url,
  reporter_name: t.reporter_name,
  has_attachment: Boolean(t.attachment_name),
  attachment_name: t.attachment_name,
  attachment_mime: t.attachment_mime,
  attachment_size: t.attachment_size,
  message_count: t.message_count !== undefined ? Number(t.message_count) : undefined,
  last_reply_from_platform: t.last_author === 'platform',
  resolved_at: t.resolved_at,
  last_activity_at: t.last_activity_at,
  created_at: t.created_at,
});

const listColumns = (trx) => [
  't.id', 't.number', 't.category', 't.priority', 't.subject', 't.description', 't.status', 't.page_url', 't.reporter_name',
  't.attachment_name', 't.attachment_mime', 't.attachment_size', 't.resolved_at', 't.last_activity_at', 't.created_at',
  trx.raw(`(SELECT count(*) FROM ${MESSAGES} m WHERE m.ticket_id = t.id) AS message_count`),
  trx.raw(`(SELECT m.author_type FROM ${MESSAGES} m WHERE m.ticket_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_author`),
];

/** GET /support/tickets — los tickets del colegio (los más recientes primero). */
async function listTickets(trx, tenantId, { status } = {}) {
  await assertAvailable(trx);
  const rows = await trx(`${TICKETS} as t`)
    .where('t.tenant_id', tenantId)
    .modify((q) => status && q.andWhere('t.status', status))
    .orderBy('t.last_activity_at', 'desc')
    .select(listColumns(trx));
  return rows.map(shape);
}

/** GET /support/tickets/:id — detalle con la conversación (404 si no es del colegio). */
async function getTicket(trx, tenantId, id) {
  await assertAvailable(trx);
  const t = await trx(`${TICKETS} as t`).where({ 't.id': id, 't.tenant_id': tenantId }).first(listColumns(trx));
  if (!t) throw ApiError.notFound('Ticket no encontrado.');
  const messages = await trx(MESSAGES).where({ ticket_id: id }).orderBy('created_at').select('id', 'author_type', 'author_name', 'body', 'status_change', 'created_at');
  return { ...shape(t), messages: messages.map((m) => ({ ...m, status_change_label: m.status_change ? STATUSES[m.status_change] : null })) };
}

/**
 * POST /support/tickets — { category, priority, subject, description, pageUrl? } + adjunto opcional.
 * `user` = { id, fullName, email } de quien reporta.
 */
async function createTicket(trx, tenantId, user, data, file = null, userAgent = null) {
  await assertAvailable(trx);
  let attachment = {};
  if (file) {
    const mime = sniffAttachment(file.buffer);
    if (!mime) throw ApiError.badRequest('El adjunto no es una imagen JPG/PNG ni un PDF válido.', [{ path: 'attachment', message: 'Archivo no válido.' }]);
    attachment = { attachment_name: file.originalname.slice(0, 255), attachment_mime: mime, attachment_size: file.size, attachment_data: file.buffer };
  }
  const [row] = await trx(TICKETS)
    .insert({
      tenant_id: tenantId,
      reported_by: user.id,
      reporter_name: user.fullName || user.email || 'Administrador',
      reporter_email: user.email || null,
      category: data.category,
      priority: data.priority,
      subject: data.subject.trim(),
      description: data.description.trim(),
      page_url: data.pageUrl || null,
      user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
      ...attachment,
    })
    .returning('id');
  return getTicket(trx, tenantId, row.id);
}

/**
 * POST /support/tickets/:id/messages — el colegio responde o agrega información.
 * Si el ticket estaba resuelto, se reabre (vuelve a "Abierto"). Un ticket cerrado no admite mensajes.
 */
async function addMessage(trx, tenantId, user, id, body) {
  const ticket = await getTicket(trx, tenantId, id);
  if (ticket.status === 'closed') throw ApiError.conflict('El ticket está cerrado. Si el problema continúa, abre un ticket nuevo.');
  const reopen = ticket.status === 'resolved';
  await trx(MESSAGES).insert({
    ticket_id: id,
    author_type: 'school',
    author_user_id: user.id,
    author_name: user.fullName || user.email || 'Administrador',
    body: body.trim(),
    status_change: reopen ? 'open' : null,
  });
  await trx(TICKETS)
    .where({ id, tenant_id: tenantId })
    .update({ last_activity_at: trx.fn.now(), updated_at: trx.fn.now(), ...(reopen ? { status: 'open', resolved_at: null } : {}) });
  return getTicket(trx, tenantId, id);
}

/** GET /support/tickets/:id/attachment — el adjunto (solo del colegio). */
async function getAttachment(trx, tenantId, id) {
  await assertAvailable(trx);
  const t = await trx(TICKETS).where({ id, tenant_id: tenantId }).first('attachment_name', 'attachment_mime', 'attachment_data');
  if (!t?.attachment_data) throw ApiError.notFound('El ticket no tiene adjunto.');
  return { name: t.attachment_name, mime: t.attachment_mime, data: t.attachment_data };
}

module.exports = { CATEGORIES, PRIORITIES, STATUSES, listTickets, getTicket, createTicket, addMessage, getAttachment };
