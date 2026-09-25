const knex = require('knex');
const knexConfig = require('../../knexfile');

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
  return db.transaction(async (trx) => {
    // set_config(..., true) = equivalente a SET LOCAL, pero sí acepta
    // parámetros ligados (SET LOCAL crudo no admite placeholders y
    // obligaría a interpolar el UUID a mano).
    await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [tenantId]);
    return work(trx);
  });
}

module.exports = { db, withTenantTransaction };
