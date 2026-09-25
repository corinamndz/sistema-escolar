/**
 * Cache en memoria muy simple, con TTL, para no golpear la base de datos en
 * cada request al calcular permisos efectivos de un usuario.
 *
 * En un despliegue con más de una instancia del backend, reemplazar esto por
 * un cliente de Redis con la misma interfaz (get/set/del) — el resto del
 * código (permission.middleware.js) no cambia.
 */
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, { ttlSeconds = 300 } = {}) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function del(key) {
  store.delete(key);
}

function delByPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { get, set, del, delByPrefix };
