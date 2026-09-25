/**
 * Error de aplicación con código HTTP explícito. Los controladores/servicios
 * lanzan esto y el error handler global (ver app.js) lo traduce a la
 * respuesta JSON `{ error: { message, details } }`.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }
  static unauthorized(message = 'No autenticado.') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'No tienes permiso para esta acción.') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Recurso no encontrado.') {
    return new ApiError(404, message);
  }
  static conflict(message, details) {
    return new ApiError(409, message, details);
  }
  static unprocessable(message, details) {
    return new ApiError(422, message, details);
  }
}

module.exports = { ApiError };
