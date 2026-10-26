const catalog = require('./auditCatalog');

/**
 * Bitácora de auditoría (audit_logs, migración 055).
 *
 *   Automática: tenant.middleware llama a recordRequest() al terminar cada
 *   petición que modifica datos (POST/PUT/PATCH/DELETE) con éxito, ANTES de
 *   confirmar la transacción: el registro y el cambio se guardan juntos (si el
 *   cambio se revierte, el registro también). El nombre de la acción sale de
 *   auditCatalog.js.
 *
 *   Explícita: logAudit(trx, { tenantId, action, module, summary, diff… }) para
 *   eventos con más detalle o fuera de una petición (inicio de sesión). Dentro
 *   de una petición REEMPLAZA al registro genérico y hereda usuario, IP y ruta.
 *
 * Nunca rompe la operación que audita: cada inserción corre en un SAVEPOINT y
 * un error solo se informa en consola.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE = /pass|token|secret|clave|contrase|otp|api_?key|hash|_enc$|credential/i;
const MAX_REQUEST_CHARS = 8000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copia sin contraseñas ni tokens, con textos y listas acotados. */
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => sanitize(v, depth + 1));
    return value.length > 50 ? [...items, `… y ${value.length - 50} más`] : items;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[oculto]' : sanitize(v, depth + 1)]));
}

function capped(obj) {
  const clean = sanitize(obj);
  const text = JSON.stringify(clean ?? null);
  if (text.length <= MAX_REQUEST_CHARS) return clean;
  return { _truncated: true, keys: Object.keys(clean || {}) };
}

/** Nombre visible del registro afectado, si la petición o la respuesta lo traen. */
function labelOf(...sources) {
  for (const s of sources) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const full = s.full_name || s.fullName || ([s.first_name, s.last_name].filter(Boolean).join(' ') || [s.firstName, s.lastName].filter(Boolean).join(' '));
    const label = full || s.name || s.title || s.period_label || s.periodLabel || s.username;
    if (label && typeof label === 'string') return label.length > 80 ? `${label.slice(0, 80)}…` : label;
  }
  return null;
}

const clientIp = (req) => (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64) || null;
const userAgent = (req) => String(req.get?.('user-agent') || '').slice(0, 300) || null;

async function insert(trx, rows) {
  if (!rows.length) return;
  try {
    await trx.transaction((sp) => sp('audit_logs').insert(rows));
  } catch (err) {
    console.error('[auditoría] No se pudo registrar:', err.message);
  }
}

function toRow(e) {
  return {
    tenant_id: e.tenantId,
    user_id: e.userId || null,
    actor_name: e.actorName || null,
    actor_username: e.actorUsername || null,
    action: String(e.action).slice(0, 60),
    module: e.module || null,
    entity: String(e.entity || e.module || 'system').slice(0, 60),
    entity_id: e.entityId && UUID.test(String(e.entityId)) ? e.entityId : null,
    summary: e.summary ? String(e.summary).slice(0, 500) : null,
    diff: e.diff === undefined || e.diff === null ? null : JSON.stringify(sanitize(e.diff)),
    ip_address: e.ip || null,
    user_agent: e.userAgent || null,
    request: e.request ? JSON.stringify(e.request) : null,
  };
}

/**
 * Registra un evento. `trx`: la transacción del request (se completa con el
 * contexto de la petición al terminar) o cualquier otra (se guarda ya).
 * entry: { tenantId, action, module, summary?, entity?, entityId?, diff?, userId?, actorName?, actorUsername?, ip?, userAgent? }
 */
async function logAudit(trx, entry) {
  if (trx?.__audit) {
    trx.__audit.entries.push(entry);
    return;
  }
  await insert(trx, [toRow(entry)]);
}

/** tenant.middleware: prepara el registro automático de esta petición. */
function attach(req, res) {
  req.db.__audit = { entries: [] };
  const json = res.json.bind(res);
  res.json = (body) => {
    res.locals.auditBody = body;
    return json(body);
  };
}

/** Ruta declarada en Express, sin /api ni barra final: "/payments/:id/mark-paid". */
function routeOf(req) {
  if (!req.route) return null;
  const route = `${req.baseUrl || ''}${req.route.path}`.replace(/^\/api/, '').replace(/\/+$/, '');
  return route || '/';
}

async function actorOf(req) {
  const u = await req.db('users').where({ id: req.user.id, tenant_id: req.tenantId }).first('full_name', 'username');
  return { actorName: u?.full_name || null, actorUsername: u?.username || req.user.username || null };
}

/** tenant.middleware, al terminar con éxito: escribe lo pendiente o el registro genérico. */
async function recordRequest(req, res) {
  const audit = req.db?.__audit;
  if (!audit || !req.user || res.statusCode >= 400) return;
  const route = routeOf(req);
  const pending = audit.entries.splice(0);
  if (!MUTATING.has(req.method) && !pending.length) return;
  if (!route && !pending.length) return;

  const described = route ? catalog.describe(req.method, route) : null;
  if (!described && !pending.length) return;

  const context = {
    tenantId: req.tenantId,
    userId: req.user.id,
    ...(await actorOf(req)),
    ip: clientIp(req),
    userAgent: userAgent(req),
    request: {
      method: req.method,
      route,
      path: req.originalUrl.split('?')[0].slice(0, 300),
      status: res.statusCode,
      params: req.params && Object.keys(req.params).length ? req.params : undefined,
      query: req.query && Object.keys(req.query).length ? capped(req.query) : undefined,
      body: req.body && Object.keys(req.body).length ? capped(req.body) : undefined,
      file: req.file ? { name: req.file.originalname, size: req.file.size, type: req.file.mimetype } : undefined,
    },
  };

  if (pending.length) {
    await insert(req.db, pending.map((e) => toRow({ ...context, module: described?.module, ...e })));
    return;
  }
  const body = res.locals.auditBody;
  const label = labelOf(body, req.body);
  await insert(req.db, [
    toRow({
      ...context,
      action: described.action,
      module: described.module,
      entity: described.module,
      entityId: req.params?.id || (body && typeof body === 'object' ? body.id : null),
      summary: `${described.phrase}${label ? ` «${label}»` : ''}`,
    }),
  ]);
}

/** Contexto de la petición para eventos registrados fuera de tenant.middleware (login). */
const requestContext = (req) => ({ ip: clientIp(req), userAgent: userAgent(req) });

module.exports = { logAudit, attach, recordRequest, requestContext, sanitize, labelOf };
