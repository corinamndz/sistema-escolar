const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');

/**
 * Notificaciones de la campana (migración 031).
 *
 * Una notificación se guarda UNA vez por colegio con su público (`audience`):
 *   staff      quien administra pagos (permiso de lectura de Pagos: el
 *              Administrador y los roles de finanzas)
 *   guardians  los representantes (usuarios vinculados a un representante)
 * Lo leído se guarda por usuario en notification_reads.
 */

const WINDOW_DAYS = 60; // la campana muestra lo de los últimos dos meses
const LIMIT = 30;

/** ¿Existe la tabla (migración 031)? Antes de migrar no se notifica y la campana queda vacía. */
let tableReady = false;
async function hasTables(trx) {
  if (tableReady) return true;
  const { rows } = await trx.raw("SELECT to_regclass('notification_reads') IS NOT NULL AS ok");
  tableReady = rows[0].ok;
  return tableReady;
}

/**
 * Crea una notificación. Con `dedupeKey`, no se repite: si ya existe en el
 * colegio, no hace nada. Devuelve la creada o null.
 */
async function createNotification(trx, tenantId, { type, title, body, data = {}, audience, dedupeKey = null }) {
  if (!(await hasTables(trx))) return null;
  const rows = await trx('notifications')
    .insert({ tenant_id: tenantId, type, title, body, data: JSON.stringify(data), audience, dedupe_key: dedupeKey })
    .onConflict(['tenant_id', 'dedupe_key'])
    .ignore()
    .returning('*');
  return rows[0] || null;
}

/** Públicos a los que pertenece el usuario. */
async function audiencesOf(trx, tenantId, userId) {
  const out = [];
  const perms = await getEffectivePermissions(trx, tenantId, userId);
  if (perms.payments?.can_read) out.push('staff');
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
  if (guardian) out.push('guardians');
  return out;
}

/** Consulta de las notificaciones visibles para el usuario (con su estado de lectura). */
function visibleQuery(trx, tenantId, userId, audiences) {
  return trx('notifications as n')
    .leftJoin('notification_reads as r', function joinRead() {
      this.on('r.notification_id', 'n.id').andOn('r.user_id', trx.raw('?', [userId]));
    })
    .where('n.tenant_id', tenantId)
    .andWhereRaw('n.audience && ?::text[]', [audiences])
    .andWhereRaw('n.created_at >= now() - (? * interval \'1 day\')', [WINDOW_DAYS]);
}

/** El enlace del detalle depende de quién mira: administración → Pagos; familia → Mis pagos. */
function linkFor(n, audiences) {
  const links = n.data?.links || {};
  if (audiences.includes('staff') && n.audience.includes('staff') && links.staff) return links.staff;
  return links.guardians || links.staff || null;
}

/** GET /notifications → { items, unread_count } del usuario. */
async function listForUser(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { items: [], unread_count: 0 };
  const audiences = await audiencesOf(trx, tenantId, userId);
  if (!audiences.length) return { items: [], unread_count: 0 };
  const rows = await visibleQuery(trx, tenantId, userId, audiences)
    .select('n.id', 'n.type', 'n.title', 'n.body', 'n.data', 'n.audience', 'n.created_at', 'r.read_at')
    .orderBy('n.created_at', 'desc')
    .limit(LIMIT);
  const unread = await visibleQuery(trx, tenantId, userId, audiences).whereNull('r.read_at').count('* as n').first();
  return {
    items: rows.map((n) => {
      const { links, ...data } = n.data || {};
      return { id: n.id, type: n.type, title: n.title, body: n.body, data, link: linkFor(n, audiences), created_at: n.created_at, read: Boolean(n.read_at) };
    }),
    unread_count: Number(unread.n),
  };
}

/** Marca una como leída (solo si el usuario puede verla: si no, 404). */
async function markRead(trx, tenantId, userId, id) {
  const audiences = (await hasTables(trx)) ? await audiencesOf(trx, tenantId, userId) : [];
  const n = audiences.length ? await visibleQuery(trx, tenantId, userId, audiences).andWhere('n.id', id).first('n.id') : null;
  if (!n) throw ApiError.notFound('Notificación no encontrada.');
  await trx('notification_reads').insert({ notification_id: id, user_id: userId, tenant_id: tenantId }).onConflict(['notification_id', 'user_id']).ignore();
  return { id, read: true };
}

/** Marca como leídas todas las visibles. */
async function markAllRead(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { marked: 0 };
  const audiences = await audiencesOf(trx, tenantId, userId);
  if (!audiences.length) return { marked: 0 };
  const ids = await visibleQuery(trx, tenantId, userId, audiences).whereNull('r.read_at').pluck('n.id');
  if (ids.length) {
    await trx('notification_reads')
      .insert(ids.map((id) => ({ notification_id: id, user_id: userId, tenant_id: tenantId })))
      .onConflict(['notification_id', 'user_id'])
      .ignore();
  }
  return { marked: ids.length };
}

/**
 * Cuántos usuarios ACTIVOS reciben un aviso para ese público: { staff, guardians }.
 * staff = usuarios con lectura de Pagos (sin contar el rol Representante, que
 * no aporta permisos administrativos); guardians = representantes con acceso.
 */
async function countRecipients(trx, tenantId, audience) {
  const out = { staff: 0, guardians: 0 };
  if (audience.includes('staff')) {
    const row = await trx('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .join('modules as m', 'm.id', 'rp.module_id')
      .join('users as u', 'u.id', 'ur.user_id')
      .where({ 'rp.tenant_id': tenantId, 'm.code': 'payments', 'rp.can_read': true, 'u.status': 'active' })
      .whereNot('r.name', 'Representante')
      .countDistinct('ur.user_id as n')
      .first();
    out.staff = Number(row.n);
  }
  if (audience.includes('guardians')) {
    const row = await trx('guardians as g')
      .join('users as u', 'u.id', 'g.user_id')
      .where({ 'g.tenant_id': tenantId, 'u.status': 'active' })
      .countDistinct('g.user_id as n')
      .first();
    out.guardians = Number(row.n);
  }
  return out;
}

/** Borra los avisos de prueba (data.simulated) del colegio. */
async function deleteSimulated(trx, tenantId) {
  if (!(await hasTables(trx))) return 0;
  return trx('notifications').where({ tenant_id: tenantId }).andWhereRaw("(data->>'simulated')::boolean IS TRUE").delete();
}

module.exports = { createNotification, listForUser, markRead, markAllRead, countRecipients, deleteSimulated };
