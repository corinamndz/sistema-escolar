/**
 * Envuelve un controller async para que cualquier excepción (incluido un
 * reject de una promesa) llegue al `next(err)` de Express en vez de colgar
 * el request. Evita repetir try/catch en cada controller.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
