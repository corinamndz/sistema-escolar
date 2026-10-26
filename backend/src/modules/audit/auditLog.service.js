const { ApiError } = require('../../utils/ApiError');
const { moduleLabel } = require('../../services/audit/auditCatalog');

const MAX_ROWS = 500;

/** "CONFIRMAR_PAGO" → "Confirmar pago" */
const actionLabel = (code) => {
  const text = String(code || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\banio\b/g, 'año')
    .replace(/contrasena/g, 'contraseña')
    .replace(/^inicio sesion/, 'inicio de sesion')
    .replace(/sesion/g, 'sesión');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const decorate = (r) => ({ ...r, module_label: moduleLabel(r.module || r.entity), action_label: actionLabel(r.action) });

/**
 * Bitácora del colegio, de lo más reciente a lo más antiguo (máx. 500 por
 * consulta: `has_more` avisa que conviene acotar el período).
 * Filtros: from / to (fecha, hora de Venezuela), module, userId, action, q (texto).
 */
async function listLogs(trx, tenantId, { from, to, module, userId, action, q } = {}) {
  const query = trx('audit_logs as a')
    .where('a.tenant_id', tenantId)
    .modify((qb) => {
      if (from) qb.andWhereRaw("a.created_at >= (?::date)::timestamp AT TIME ZONE 'America/Caracas'", [from]);
      if (to) qb.andWhereRaw("a.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'America/Caracas')", [to]);
      if (module) qb.andWhere('a.module', module);
      if (userId) qb.andWhere('a.user_id', userId);
      if (action) qb.andWhere('a.action', action);
      if (q) {
        const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        qb.andWhere((w) =>
          w.whereILike('a.summary', like).orWhereILike('a.actor_name', like).orWhereILike('a.actor_username', like).orWhereILike('a.action', like).orWhereILike('a.ip_address', like)
        );
      }
    });
  const rows = await query
    .clone()
    .select('a.id', 'a.created_at', 'a.user_id', 'a.actor_name', 'a.actor_username', 'a.module', 'a.entity', 'a.action', 'a.summary', 'a.ip_address')
    .orderBy('a.created_at', 'desc')
    .limit(MAX_ROWS + 1);
  return { items: rows.slice(0, MAX_ROWS).map(decorate), has_more: rows.length > MAX_ROWS, limit: MAX_ROWS };
}

async function getLog(trx, tenantId, id) {
  const row = await trx('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.user_id')
    .where({ 'a.id': id, 'a.tenant_id': tenantId })
    .select('a.*', 'u.full_name as current_user_name', 'u.status as current_user_status')
    .first();
  if (!row) throw ApiError.notFound('Registro de auditoría no encontrado.');
  return decorate(row);
}

/** Valores para los filtros: módulos, usuarios y acciones que aparecen en la bitácora. */
async function getOptions(trx, tenantId) {
  const modules = await trx('audit_logs').where({ tenant_id: tenantId }).whereNotNull('module').distinct('module').pluck('module');
  const users = await trx('audit_logs')
    .where({ tenant_id: tenantId })
    .whereNotNull('user_id')
    .select('user_id as id', trx.raw('max(coalesce(actor_name, actor_username)) as name'))
    .groupBy('user_id')
    .orderBy('name');
  const actions = await trx('audit_logs').where({ tenant_id: tenantId }).distinct('action').pluck('action');
  return {
    modules: modules.map((code) => ({ code, label: moduleLabel(code) })).sort((a, b) => a.label.localeCompare(b.label, 'es')),
    users,
    actions: actions.map((code) => ({ code, label: actionLabel(code) })).sort((a, b) => a.label.localeCompare(b.label, 'es')),
  };
}

module.exports = { listLogs, getLog, getOptions };
