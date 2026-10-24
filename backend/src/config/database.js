const knex = require('knex');
const { types } = require('pg');
const knexConfig = require('../../knexfile');

// Columnas DATE (OID 1082) como texto 'YYYY-MM-DD'. Por defecto `pg` las
// convierte en Date a medianoche de la zona horaria del SERVIDOR NODE y, al
// serializar a JSON (UTC), un servidor con zona horaria positiva (ej. Europe/Madrid)
// enviaba '2026-10-05' como '2026-10-04T22:00:00Z': un día antes. Las fechas
// de calendario (nacimiento, vencimientos, inicio de año escolar) no tienen hora.
types.setTypeParser(1082, (value) => value);

const environment = process.env.NODE_ENV || 'development';
const db = knex(knexConfig[environment]);

/**
 * Multi-tenancy, capa 2 (RLS): antes de correr cualquier query dentro de un
 * request, fijamos `app.tenant_id` en la sesión de PostgreSQL. Las políticas
 * RLS creadas en migrations/001_init.sql usan ese valor para filtrar filas,
 * así que aunque un service olvide el `.where({ tenant_id })`, la base de
 * datos igual bloquea el acceso cruzado entre colegios.
 *
 * `tenant.middleware.js` llama a esto una vez por request, dentro de una
 * transacción que se usa para todo el ciclo de vida del request (ver
 * `withTenantTransaction`).
 */
async function withTenantTransaction(tenantId, work) {
  const schemaName = await tenantSchemaOf(tenantId);
  return db.transaction(async (trx) => {
    await scopeToTenant(trx, tenantId, schemaName);
    return work(trx);
  });
}

/**
 * Acota una transacción a un colegio:
 *   - `app.tenant_id` → políticas RLS (capa 2, igual que siempre);
 *   - `search_path`   → si el colegio tiene ESQUEMA PROPIO (tenants.schema_name,
 *     lo asigna el Tenant Manager al crearlo), las tablas del colegio se
 *     resuelven ahí y las globales (tenants, modules, currencies,
 *     education_levels) y las funciones de los triggers siguen en public.
 *     Sin esquema propio (colegios anteriores) todo sigue en public.
 * set_config(..., true) = equivalente a SET LOCAL, pero acepta parámetros
 * ligados; se deshace solo al terminar la transacción.
 */
async function scopeToTenant(trx, tenantId, schemaName, userId = null) {
  // app.user_id: quién hace el cambio, para auditorías por trigger (ej. historial de tasas).
  await trx.raw("SELECT set_config('app.tenant_id', ?, true), set_config('app.user_id', ?, true)", [tenantId, userId || '']);
  if (schemaName) {
    // Defensa en profundidad: además de citarse con %I, solo se aceptan nombres
    // válidos (mismas reglas que el Tenant Manager, migración 003 del admin).
    if (!isValidSchemaName(schemaName)) throw new Error(`Esquema de colegio inválido: "${schemaName}".`);
    await trx.raw("SELECT set_config('search_path', format('%I, public', ?::text), true)", [schemaName]);
  }
}

/** Nombre de esquema de colegio válido (minúsculas, dígitos y "_"; nunca public/platform/pg_*). */
const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED_SCHEMAS = new Set(['public', 'platform', 'information_schema']);
const isValidSchemaName = (s) => typeof s === 'string' && SCHEMA_RE.test(s) && !RESERVED_SCHEMAS.has(s) && !s.startsWith('pg_');

// El esquema de un colegio no cambia una vez asignado: se cachea para no
// consultarlo en cada request. Los "sin esquema" se reconsultan cada minuto.
const SCHEMA_TTL_MS = 60_000;
const schemaCache = new Map(); // tenantId → { schemaName, expiresAt }

async function tenantSchemaOf(tenantId) {
  const hit = schemaCache.get(tenantId);
  if (hit && (hit.schemaName || hit.expiresAt > Date.now())) return hit.schemaName;
  // to_jsonb(t)->>'schema_name': funciona aunque la columna aún no exista en esta base.
  const row = await db('tenants as t').where('t.id', tenantId).first(db.raw("to_jsonb(t)->>'schema_name' AS schema_name"));
  const schemaName = row?.schema_name || null;
  schemaCache.set(tenantId, { schemaName, expiresAt: Date.now() + SCHEMA_TTL_MS });
  return schemaName;
}

module.exports = { db, withTenantTransaction, scopeToTenant, tenantSchemaOf, isValidSchemaName };
