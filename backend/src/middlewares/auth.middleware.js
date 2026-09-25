const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/ApiError');

/**
 * Decodifica el JWT del header `Authorization: Bearer <token>` y adjunta
 * `req.user = { id, tenantId, username, roleIds }` al request.
 *
 * Debe ir ANTES de tenant.middleware en toda ruta protegida, porque
 * tenant.middleware lee `req.user.tenantId` para saber qué tenant activar
 * en la base de datos (RLS). Las únicas rutas que no llevan este middleware
 * son login y health check.
 */
function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Falta el token de autenticación.');
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('El token expiró, inicia sesión de nuevo.');
      }
      throw ApiError.unauthorized('Token inválido.');
    }

    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      username: payload.username,
      roleIds: payload.roleIds || [],
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authMiddleware };
