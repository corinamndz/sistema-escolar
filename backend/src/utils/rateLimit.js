const { ApiError } = require('./ApiError');

/**
 * Límite de peticiones en memoria (ventana deslizante), para las rutas públicas
 * que escriben sin sesión (p. ej. la solicitud de cupo del sitio web).
 *
 *   const limit = rateLimit({ windowMs: 3600e3, max: 5, key: (req) => req.ip, message })
 *   router.post('/x', limit, handler)
 *
 * Está en la memoria de ESTE proceso: con varias instancias del servidor, cada una
 * cuenta por su lado (para eso haría falta un almacén compartido, p. ej. Redis).
 */
function rateLimit({ windowMs, max, key, message = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' }) {
  const hits = new Map(); // clave → [marcas de tiempo]
  // Limpieza periódica para que el mapa no crezca sin fin.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const recent = list.filter((t) => t > cutoff);
      if (recent.length) hits.set(k, recent);
      else hits.delete(k);
    }
  }, Math.min(windowMs, 10 * 60 * 1000));
  sweep.unref?.();

  const middleware = (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const recent = (hits.get(k) || []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - now) / 1000)));
      return next(new ApiError(429, message));
    }
    recent.push(now);
    hits.set(k, recent);
    return next();
  };
  middleware.reset = () => hits.clear(); // para las pruebas
  return middleware;
}

module.exports = { rateLimit };
