const { ApiError } = require('../../utils/ApiError');
const { getEffectivePermissions } = require('../../middlewares/permission.middleware');
const tuitionImpact = require('../payments/tuitionImpact.service');

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
 *
 * Avisos PERSONALES (migración 059): audience ['users'] + `target_user_ids`,
 * los ven solo esos usuarios, sean del público que sean (ej. el coordinador del
 * nivel al que llega un contenido a revisar, que no es de 'staff' ni 'guardians').
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
async function createNotification(trx, tenantId, { type, title, body, data = {}, audience, dedupeKey = null, targetGuardianIds = null, targetUserIds = null }) {
  if (!(await hasTables(trx))) return null;
  if (targetGuardianIds && !targetGuardianIds.length) return null; // dirigido a nadie
  if (targetGuardianIds && !(await hasTargets(trx))) return null; // sin la migración 036 no se puede dirigir
  if (targetUserIds && !targetUserIds.filter(Boolean).length) return null;
  const rows = await trx('notifications')
    .insert({
      tenant_id: tenantId,
      type,
      title,
      body,
      data: JSON.stringify(data),
      audience: targetUserIds ? ['users'] : audience,
      dedupe_key: dedupeKey,
      ...(targetGuardianIds ? { target_guardian_ids: [...new Set(targetGuardianIds)] } : {}),
      ...(targetUserIds ? { target_user_ids: [...new Set(targetUserIds.filter(Boolean))] } : {}),
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

/**
 * Consulta de las notificaciones visibles para el usuario (con su estado de lectura).
 * `windowDays`: la campana mira los últimos WINDOW_DAYS; el Centro de notificaciones, todo (null).
 * Índices que usa: notifications (tenant_id, created_at DESC) para el orden y el rango de
 * fechas, y la PK de notification_reads (notification_id, user_id) para el estado de lectura.
 */
function visibleQuery(trx, tenantId, userId, { audiences, guardianId, targets }, { windowDays = WINDOW_DAYS } = {}) {
  return trx('notifications as n')
    .leftJoin('notification_reads as r', function joinRead() {
      this.on('r.notification_id', 'n.id').andOn('r.user_id', trx.raw('?', [userId]));
    })
    .where('n.tenant_id', tenantId)
    .andWhere((visible) =>
      visible
        // De su público (Administración / familias)…
        .where((pub) =>
          pub
            .whereRaw('n.audience && ?::text[]', [audiences])
            // Dirigidas: solo si el usuario es uno de los representantes destinatarios.
            .modify((q) => targets && q.andWhere((w) => w.whereNull('n.target_guardian_ids').orWhereRaw('?::uuid = ANY(n.target_guardian_ids)', [guardianId])))
        )
        // …o personales para él.
        .orWhereRaw("'users' = ANY(n.audience) AND ?::uuid = ANY(n.target_user_ids)", [userId])
    )
    .modify((q) => windowDays && q.andWhereRaw('n.created_at >= now() - (? * interval \'1 day\')', [windowDays]));
}

/** El enlace del detalle depende de quién mira: administración → Pagos; familia → Mis pagos. */
function linkFor(n, audiences) {
  const links = n.data?.links || {};
  if (n.audience.includes('users') && links.users) return links.users;
  if (audiences.includes('staff') && n.audience.includes('staff') && links.staff) return links.staff;
  return links.guardians || links.staff || null;
}

/** GET /notifications → { items, unread_count } del usuario. */
async function listForUser(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { items: [], unread_count: 0 };
  // Sin público igual puede tener avisos personales (coordinadores, docentes).
  const who = await audiencesOf(trx, tenantId, userId);
  const { audiences } = who;
  const rows = await visibleQuery(trx, tenantId, userId, who)
    .select('n.id', 'n.type', 'n.title', 'n.body', 'n.data', 'n.audience', 'n.created_at', 'r.read_at')
    .orderBy('n.created_at', 'desc')
    .limit(LIMIT);
  const unread = await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').count('* as n').first();
  return { items: await withFamilyTuition(trx, tenantId, who, rows.map((n) => toItem(n, audiences))), unread_count: Number(unread.n) };
}

/** Fila → aviso para el cliente: sin los enlaces internos, con el que corresponde a quien mira. */
function toItem(n, audiences) {
  const { links, ...data } = n.data || {};
  return { id: n.id, type: n.type, title: n.title, body: n.body, data, link: linkFor(n, audiences), created_at: n.created_at, read: Boolean(n.read_at), read_at: n.read_at || null };
}

/**
 * Aviso de tasa BCV visto por un representante: agrega `data.my_tuition`, la
 * mensualidad de cada uno de SUS alumnos con la tasa de ese aviso (según la
 * tabla `data.tuition` que se guardó al emitirlo). Una consulta por año escolar.
 */
async function withFamilyTuition(trx, tenantId, who, items) {
  if (!who.guardianId) return items;
  const cache = new Map();
  for (const item of items) {
    const table = item.type === 'bcv_rate' ? item.data?.tuition : null;
    if (!table?.fees?.length) continue;
    const key = table.school_period.id;
    if (!cache.has(key)) cache.set(key, await tuitionImpact.familyStudents(trx, tenantId, who.guardianId, key));
    item.data.my_tuition = tuitionImpact.applyFees(cache.get(key), table);
  }
  return items;
}

// Fechas del filtro: días calendario del colegio (como en Auditoría), sin envolver la columna para usar el índice.
const TZ = 'America/Caracas';

/**
 * GET /notifications/history — Centro de notificaciones: historial completo y paginado.
 *   status: 'all' | 'unread' | 'read'; from/to: 'YYYY-MM-DD' (inclusive); type: tipo de aviso.
 * → { items, total, page, page_size, unread_count, types: [tipos presentes en su historial] }
 * El total sale de la misma consulta (COUNT(*) OVER ()), sin una segunda pasada.
 */
async function history(trx, tenantId, userId, { status = 'all', from = null, to = null, type = null, page = 1, pageSize = 20 } = {}) {
  const empty = { items: [], total: 0, page, page_size: pageSize, unread_count: 0, types: [] };
  if (!(await hasTables(trx))) return empty;
  const who = await audiencesOf(trx, tenantId, userId);
  const all = () => visibleQuery(trx, tenantId, userId, who, { windowDays: null });

  const filtered = () =>
    all().modify((q) => {
      if (status === 'unread') q.whereNull('r.read_at');
      if (status === 'read') q.whereNotNull('r.read_at');
      if (from) q.andWhereRaw('n.created_at >= (?::date)::timestamp AT TIME ZONE ?', [from, TZ]);
      if (to) q.andWhereRaw('n.created_at < ((?::date + 1)::timestamp AT TIME ZONE ?)', [to, TZ]);
      if (type) q.andWhere('n.type', type);
    });

  const rows = await filtered()
    .select('n.id', 'n.type', 'n.title', 'n.body', 'n.data', 'n.audience', 'n.created_at', 'r.read_at', trx.raw('COUNT(*) OVER () AS total'))
    .orderBy([{ column: 'n.created_at', order: 'desc' }, { column: 'n.id', order: 'desc' }])
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [unread, types] = await Promise.all([
    all().whereNull('r.read_at').count('* as n').first(),
    all().distinct('n.type').pluck('n.type'),
  ]);
  return {
    items: rows.map((n) => toItem(n, who.audiences)),
    // Página fuera de rango: no hay filas de donde leer el total; se cuenta aparte.
    total: rows.length ? Number(rows[0].total) : page > 1 ? Number((await filtered().count('* as n').first()).n) : 0,
    page,
    page_size: pageSize,
    unread_count: Number(unread.n),
    types: types.sort(),
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
  const unread = await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').count('* as n').first();
  const count = Number(unread.n);
  const latest = count
    ? await visibleQuery(trx, tenantId, userId, who).whereNull('r.read_at').select('n.id', 'n.type', 'n.title', 'n.created_at').orderBy('n.created_at', 'desc').limit(3)
    : [];
  return { unread_count: count, latest };
}

/** Marca una como leída (solo si el usuario puede verla: si no, 404). */
async function markRead(trx, tenantId, userId, id) {
  // Sin ventana de días: desde el Centro de notificaciones se marcan también las antiguas.
  const n = (await hasTables(trx)) ? await visibleQuery(trx, tenantId, userId, await audiencesOf(trx, tenantId, userId), { windowDays: null }).andWhere('n.id', id).first('n.id') : null;
  if (!n) throw ApiError.notFound('Notificación no encontrada.');
  await trx('notification_reads').insert({ notification_id: id, user_id: userId, tenant_id: tenantId }).onConflict(['notification_id', 'user_id']).ignore();
  return { id, read: true };
}

/**
 * Marca como leídas todas las visibles (todo el historial, no solo lo de la campana),
 * en una sola sentencia: INSERT … SELECT de las no leídas, sin traer los ids a Node.
 */
async function markAllRead(trx, tenantId, userId) {
  if (!(await hasTables(trx))) return { marked: 0 };
  const who = await audiencesOf(trx, tenantId, userId);
  const unread = visibleQuery(trx, tenantId, userId, who, { windowDays: null })
    .whereNull('r.read_at')
    .select('n.id', trx.raw('?::uuid', [userId]), trx.raw('?::uuid', [tenantId]));
  const result = await trx.raw('INSERT INTO notification_reads (notification_id, user_id, tenant_id) ? ON CONFLICT (notification_id, user_id) DO NOTHING', [unread]);
  return { marked: result.rowCount };
}

/**
 * Destinatarios de un aviso con su estado de lectura (migración 061):
 *   - la foto de destinatarios al enviarlo (notification_recipients);
 *   - más quien lo leyó sin estar en la foto (p. ej. un representante con
 *     acceso creado después): cuenta como destinatario "posterior" (late).
 * read_at sale de notification_reads (NULL = pendiente de lectura).
 */
const RECIPIENTS_CTE = `
  people AS (
    SELECT nr.user_id, nr.sent_at, false AS late
    FROM notification_recipients nr
    WHERE nr.notification_id = :id
    UNION ALL
    SELECT rd.user_id, rd.read_at, true
    FROM notification_reads rd
    WHERE rd.notification_id = :id
      AND NOT EXISTS (SELECT 1 FROM notification_recipients nr WHERE nr.notification_id = rd.notification_id AND nr.user_id = rd.user_id)
  ),
  detail AS (
    SELECT p.user_id, p.sent_at, p.late, rd.read_at,
           COALESCE(u.full_name, u.username) AS name, u.username, u.status AS user_status,
           g.id AS guardian_id,
           COALESCE((SELECT array_agg(ro.name ORDER BY ro.hierarchy_level NULLS LAST, ro.name)
                     FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id
                     WHERE ur.user_id = p.user_id), '{}') AS roles
    FROM people p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN notification_reads rd ON rd.notification_id = :id AND rd.user_id = p.user_id
    LEFT JOIN guardians g ON g.user_id = p.user_id AND g.tenant_id = :tenantId
  )`;

/**
 * GET /notifications/:id/audit — trazabilidad de lectura de un aviso:
 * { notification, stats: { sent, read, pending, read_percent, guardians: {sent, read}, staff: {sent, read} }, recipients }
 * Los destinatarios vienen ordenados: leídos (del más reciente) y luego pendientes (A→Z).
 */
async function readAudit(trx, tenantId, id) {
  const n = await trx('notifications').where({ id, tenant_id: tenantId }).first('id', 'type', 'title', 'body', 'audience', 'data', 'created_at', 'target_guardian_ids', 'target_user_ids');
  if (!n) throw ApiError.notFound('Notificación no encontrada.');
  const binds = { id, tenantId };

  const { rows: [stats] } = await trx.raw(
    `WITH ${RECIPIENTS_CTE}
     SELECT count(*)::int                                                         AS sent,
            count(read_at)::int                                                   AS read,
            round(100.0 * count(read_at) / NULLIF(count(*), 0), 1)::float         AS read_percent,
            count(*) FILTER (WHERE guardian_id IS NOT NULL)::int                  AS guardians_sent,
            count(read_at) FILTER (WHERE guardian_id IS NOT NULL)::int            AS guardians_read,
            count(*) FILTER (WHERE late)::int                                     AS late,
            min(read_at)                                                          AS first_read_at,
            max(read_at)                                                          AS last_read_at
     FROM detail`,
    binds
  );
  const { rows: recipients } = await trx.raw(
    `WITH ${RECIPIENTS_CTE}
     SELECT * FROM detail
     ORDER BY read_at IS NULL, read_at DESC, name`,
    binds
  );

  const { links, ...data } = n.data || {};
  return {
    notification: { id: n.id, type: n.type, title: n.title, body: n.body, data, created_at: n.created_at, audience: n.audience },
    stats: {
      sent: stats.sent,
      read: stats.read,
      pending: stats.sent - stats.read,
      read_percent: stats.read_percent ?? 0,
      guardians: { sent: stats.guardians_sent, read: stats.guardians_read },
      staff: { sent: stats.sent - stats.guardians_sent, read: stats.read - stats.guardians_read },
      late: stats.late,
      first_read_at: stats.first_read_at,
      last_read_at: stats.last_read_at,
    },
    recipients: recipients.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      username: r.username,
      roles: r.roles,
      is_guardian: Boolean(r.guardian_id),
      user_active: r.user_status === 'active',
      status: r.read_at ? 'read' : 'pending',
      sent_at: r.sent_at,
      read_at: r.read_at,
      late: r.late,
    })),
  };
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

module.exports = { unreadSummary, createNotification, listForUser, history, readAudit, markRead, markAllRead, countRecipients, deleteSimulated };
