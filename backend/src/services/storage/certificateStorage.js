const fs = require('fs/promises');
const { existsSync } = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Fondos de certificados: backend/storage/certificates/<tenantId>/<uuid>.<ext>
 * Privados: no se publican como estáticos, se sirven por una ruta con sesión.
 * El nombre es aleatorio (nada del nombre original) y toda ruta se resuelve dentro
 * de la carpeta del colegio que la pide.
 */
const ROOT = path.join(__dirname, '..', '..', '..', 'storage', 'certificates');
const tenantDir = (tenantId) => path.join(ROOT, String(tenantId));

async function saveBackground(tenantId, buffer, ext) {
  await fs.mkdir(tenantDir(tenantId), { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(tenantDir(tenantId), name), buffer, { flag: 'wx' });
  return name;
}

/** Ruta absoluta del fondo de ESTE colegio, o null si no existe o sale de su carpeta. */
function resolveBackground(tenantId, name) {
  if (!name) return null;
  const dir = tenantDir(tenantId);
  const full = path.resolve(dir, name);
  if (!full.startsWith(dir + path.sep)) return null;
  return existsSync(full) ? full : null;
}

/** Copia un fondo de este colegio con un nombre nuevo (para un diseño propio). → nombre, o null si no existe. */
async function copyBackground(tenantId, name) {
  const source = resolveBackground(tenantId, name);
  if (!source) return null;
  const copy = `${crypto.randomUUID()}${path.extname(source)}`;
  await fs.copyFile(source, path.join(tenantDir(tenantId), copy), require('fs').constants.COPYFILE_EXCL);
  return copy;
}

async function removeBackground(tenantId, name) {
  const full = resolveBackground(tenantId, name);
  if (!full) return;
  try {
    await fs.unlink(full);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('No se pudo borrar el fondo del certificado', err); // eslint-disable-line no-console
  }
}

module.exports = { saveBackground, resolveBackground, removeBackground, copyBackground };
