const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');

/**
 * Almacenamiento de logos de colegios en disco:
 *   backend/storage/logos/<tenantId>/<uuid>.<ext>
 *
 * En la base de datos se guarda solo la ruta relativa a `storage/`
 * (ej. `logos/<tenantId>/<uuid>.png`); la URL pública la arma `toPublicUrl`.
 * Los archivos se sirven como estáticos desde app.js en `/storage/logos`.
 */
const STORAGE_ROOT = path.join(__dirname, '..', '..', '..', 'storage');
const LOGOS_DIR = path.join(STORAGE_ROOT, 'logos');

/**
 * El tipo se decide por la firma binaria del archivo (magic bytes), no por la
 * extensión ni por el mimetype que declara el navegador, que el cliente puede
 * falsificar. Así un .html o .svg renombrado a .png nunca llega a guardarse.
 */
function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

/** Guarda el buffer validado y devuelve la ruta relativa para persistir en `tenant_settings.logo_url`. */
async function saveLogo(tenantId, buffer) {
  const ext = detectImageType(buffer);
  if (!ext) {
    throw ApiError.badRequest('El logo debe ser una imagen PNG o JPG válida.', [
      { path: 'logo', message: 'Formato no permitido. Usa PNG o JPG.' },
    ]);
  }

  const tenantDir = path.join(LOGOS_DIR, String(tenantId));
  await fs.mkdir(tenantDir, { recursive: true });

  // Nombre aleatorio: no se usa nada del nombre original (evita path traversal y colisiones).
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(tenantDir, fileName), buffer, { flag: 'wx' });

  return path.posix.join('logos', String(tenantId), fileName);
}

/** true si `relativePath` es un logo guardado por este módulo (y no una URL externa heredada). */
function isStoredLogo(relativePath) {
  return typeof relativePath === 'string' && relativePath.startsWith('logos/');
}

/**
 * Borra un logo previamente guardado. Ignora rutas que no sean de este
 * almacenamiento y verifica que el destino quede dentro de storage/logos
 * antes de tocar el disco.
 */
async function deleteLogo(relativePath) {
  if (!isStoredLogo(relativePath)) return;
  const absolute = path.resolve(STORAGE_ROOT, relativePath);
  if (!absolute.startsWith(LOGOS_DIR + path.sep)) return;
  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.error('No se pudo borrar el logo', relativePath, err);
    }
  }
}

/** Ruta relativa en BD → URL servida por el backend. Las URLs externas antiguas se devuelven tal cual. */
function toPublicUrl(storedValue) {
  if (!storedValue) return null;
  return isStoredLogo(storedValue) ? `/storage/${storedValue}` : storedValue;
}

module.exports = { LOGOS_DIR, saveLogo, deleteLogo, toPublicUrl };
