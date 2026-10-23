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
 *
 * Avisos DIRIGIDOS (migración 036): con `target_guardian_ids`, solo los ven
 * esos representantes (su pago, la sanción o el club de su hijo…). Sin él, lo
 * ve todo el público.
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

/** ¿Existe la columna de destinatarios (migración 036)? */
let targetsReady = false;
async function hasTargets(trx) {
  if (targetsReady) return true;
  // La tabla que resuelve el search_path (esquema del colegio o public).
  const { rows } = await trx.raw("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('notifications') AND attname = 'target_guardian_ids' AND NOT attisdropped) AS ok");
  targetsReady = rows[0].ok;
  return targetsReady;
}

/**
 * Crea una notificación. Con `dedupeKey`, no se repite: si ya existe en el
 * colegio, no hace nada. Devuelve la creada o null.
 */
async function createNotification(trx, tenantId, { type, title, body, data = {}, audience, dedupeKey = null, targetGuardianIds = null }) {
  if (!(await hasTables(trx))) return null;
  if (targetGuardianIds && !targetGuardianIds.length) return null; // dirigido a nadie
  if (targetGuardianIds && !(await hasTargets(trx))) return null; // sin la migración 036 no se puede dirigir
  const rows = await trx('notifications')
    .insert({
      tenant_id: tenantId,
      type,
      title,
      body,
      data: JSON.stringify(data),
      audience,
      dedupe_key: dedupeKey,
      ...(targetGuardianIds ? { target_guardian_ids: [...new Set(targetGuardianIds)] } : {}),
    })
    .onConflict(['tenant_id', 'dedupe_key'])
    .ignore()
    .returning('*');
  return rows[0] || null;
}

/** Públicos a los que pertenece el usuario: { audiences, guardianId }. */
async function audiencesOf(trx, tenantId, userId) {
  const audiences = [];
  const perms = await getEffectivePermissions(trx, tenantId, userId);
  if (perms.payments?.can_read) audiences.push('staff');
  const guardian = await trx('guardians').where({ tenant_id: tenantId, user_id: userId }).first('id');
  if (guardian) audiences.push('guardians');
  return { audiences, guardianId: guardian?.id || null, targets: await hasTargets(trx) };
}

/** Consulta de las notificaciones visibles para el usuario (con su estado de lectura). */
function visibleQuery(trx, tenantId, userId, { audiences, guardianId, targets }) {
  return trx('notifications as n')
    .leftJoin('notification_reads as r', function joinRead() {
      this.on('r.notification_id', 'n.id').andOn('r.user_id', trx.raw('?', [userId]));
    })
    .where('n.tenant_id', tenantId)
    .andWhereRaw('n.audience && ?::text[]', [audiences])
    // Dirigidas: solo si el usuario es uno de los representantes destinatarios.
    .modify((q) => targets && q.andWhere((w) => w.whereNull('n.target_guardian_ids').orWhereRaw('?::uuid = ANY(n.target_guardian_ids)', [guardianId])))
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
  const who = await audiencesOf(trx, tenantId, userId);
  const { audiences } = who;
  if (!audiences.length) return { items: [], unread_count: 0 };
  const rows = await visibleQuery(trx, tenantId, userId, who)
    .select('n.id', 'n.type', 'n.title', 'n.body', 'n.data', 'n.audience', 'n.created_at', 'r.read_at')
    .orderBy('n.created_at', 'desc')
    .limit(LIMIT);
  const unread = await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').count('* as n').first();
  return {
    items: rows.map((n) => {
      const { links, ...data } = n.data || {};
      return { id: n.id, type: n.type, title: n.title, body: n.body, data, link: linkFor(n, audiences), created_at: n.created_at, read: Boolean(n.read_at) };
    }),
    unread_count: Number(unread.n),
  };
}

/**
 * GET /notifications/unread-count → { unread_count, latest } — consulta liviana
 * para el aviso al iniciar sesión: el conteo y las 3 no leídas más recientes
 * (título, tipo y fecha), sin traer la lista completa. Vale para cualquier
 * rol: cada usuario cuenta solo las de su público (administración y/o familia).
 */
async function unreadSummary(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { unread_count: 0, latest: [] };
  const who = await audiencesOf(trx, tenantId, userId);
  if (!who.audiences.length) return { unread_count: 0, latest: [] };
  const unread = await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').count('* as n').first();
  const count = Number(unread.n);
  const latest = count
    ? await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').select('n.id', 'n.type', 'n.title', 'n.created_at').orderBy('n.created_at', 'desc').limit(3)
    : [];
  return { unread_count: count, latest };
}

/** Marca una como leída (solo si el usuario puede verla: si no, 404). */
async function markRead(trx, tenantId, userId, id) {
  const who = (await hasTables(trx)) ? await audiencesOf(trx, tenantId, userId) : { audiences: [] };
  const n = who.audiences.length ? await visibleQuery(trx, tenantId, userId, who).andWhere('n.id', id).first('n.id') : null;
  if (!n) throw ApiError.notFound('Notificación no encontrada.');
  await trx('notification_reads').insert({ notification_id: id, user_id: userId, tenant_id: tenantId }).onConflict(['notification_id', 'user_id']).ignore();
  return { id, read: true };
}

/** Marca como leídas todas las visibles. */
async function markAllRead(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { marked: 0 };
  const who = await audiencesOf(trx, tenantId, userId);
  if (!who.audiences.length) return { marked: 0 };
  const ids = await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').pluck('n.id');
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

module.exports = { unreadSummary, createNotification, listForUser, markRead, markAllRead, countRecipients, deleteSimulated };
