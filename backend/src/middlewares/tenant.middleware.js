const { db } = require('../config/database');
const { ApiError } = require('../utils/ApiError');

/**
 * Multi-tenancy en acción: abre UNA transacción por request, fija
 * `app.tenant_id` en la sesión de Postgres (RLS, ver migrations/001_init.sql)
 * y la deja disponible en `req.db` para todo el resto del pipeline
 * (controllers → services → models). La transacción se confirma cuando la
 * respuesta termina bien, o se revierte si hubo error o la conexión se cerró
 * a medias — así una excepción a mitad de un service no deja escrituras
 * parciales.
 *
 * Requiere que `authMiddleware` haya corrido antes y haya puesto
 * `req.user.tenantId`.
 */
async function tenantMiddleware(req, res, next) {
  if (!req.user || !req.user.tenantId) {
    return next(ApiError.unauthorized('No se pudo determinar el tenant del usuario.'));
  }

  let trx;
  try {
    trx = await db.transaction();
    await trx.raw("SELECT set_config('app.tenant_id', ?, true)", [req.user.tenantId]);
  } catch (err) {
    return next(err);
  }

  req.tenantId = req.user.tenantId;
  req.db = trx;

  let settled = false;
  const finalize = async (shouldCommit) => {
    if (settled) return;
    settled = true;
    try {
      if (shouldCommit && !trx.isCompleted()) {
        await trx.commit();
      } else if (!trx.isCompleted()) {
        await trx.rollback();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error cerrando la transacción del tenant:', err);
    }
  };

  res.on('finish', () => finalize(res.statusCode < 400));
  res.on('close', () => finalize(false));

  next();
}

module.exports = { tenantMiddleware };
