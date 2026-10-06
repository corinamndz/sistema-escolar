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
  /** Confirma o revierte; devuelve false si la confirmación falló. */
  const finalize = async (shouldCommit) => {
    if (settled) return true;
    settled = true;
    try {
      if (shouldCommit && !trx.isCompleted()) {
        await trx.commit();
      } else if (!trx.isCompleted()) {
        await trx.rollback();
      }
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error cerrando la transacción del tenant:', err);
      if (!trx.isCompleted()) await trx.rollback().catch(() => {});
      return !shouldCommit;
    }
  };

  // La transacción se confirma ANTES de enviar la respuesta: así, cuando el
  // cliente recibe "guardado", los datos ya están confirmados (la siguiente
  // petición los ve) y, si la confirmación falla, responde error en vez de un
  // 200 con datos que no quedaron guardados.
  const originalEnd = res.end.bind(res);
  res.end = function endAfterCommit(...args) {
    if (settled) return originalEnd(...args);
    finalize(res.statusCode < 400).then((ok) => {
      if (ok || res.headersSent) return originalEnd(...args);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.removeHeader('Content-Length');
      res.removeHeader('ETag');
      return originalEnd(JSON.stringify({ error: { message: 'No se pudieron guardar los cambios. Inténtalo de nuevo.' } }));
    });
    return res;
  };
  // Conexión cortada antes de responder: se revierte.
  res.on('close', () => finalize(false));

  next();
}

module.exports = { tenantMiddleware };
