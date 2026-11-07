const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');

/**
 * Fotos de alumnos de las planillas de inscripción.
 *
 * storage/enrollment-photos/<tenantId>/<uuid>.<jpg|png>. Son fotos de MENORES:
 * NO se sirven como archivos públicos; se entregan por una ruta con sesión
 * (administración con permiso, o el representante cuya planilla la contiene).
 * El tipo se decide por la firma binaria (magic bytes), no por la extensión.
 */
const BASE_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'enrollment-photos');
const MAX_BYTES = 4 * 1024 * 1024;
const FILE_RE = /^[0-9a-f-]{36}\.(jpg|png)$/;

function detectType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  return null;
}

/** Guarda la foto validada → nombre del archivo (lo que se guarda como respuesta del campo). */
async function savePhoto(tenantId, buffer) {
  if (!buffer?.length) throw ApiError.badRequest('Elige una foto.', [{ path: 'photo', message: 'Archivo vacío.' }]);
  if (buffer.length > MAX_BYTES) throw ApiError.badRequest('La foto no puede pesar más de 4 MB.', [{ path: 'photo', message: 'Máximo 4 MB.' }]);
  const ext = detectType(buffer);
  if (!ext) throw ApiError.badRequest('La foto debe ser JPG o PNG.', [{ path: 'photo', message: 'Formato no permitido.' }]);
  const dir = path.join(BASE_DIR, String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const file = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, file), buffer, { flag: 'wx' });
  return file;
}

const isPhotoName = (file) => typeof file === 'string' && FILE_RE.test(file);

/** Ruta en disco de una foto del colegio, o null si el nombre no es válido o no existe. */
function photoPath(tenantId, file) {
  if (!isPhotoName(file)) return null;
  const full = path.join(BASE_DIR, String(tenantId), file);
  if (!full.startsWith(path.join(BASE_DIR, String(tenantId)) + path.sep)) return null;
  return fsSync.existsSync(full) ? full : null;
}

/** Borra una foto (si existe). Errores de disco se ignoran: un archivo huérfano no rompe nada. */
async function removePhoto(tenantId, file) {
  const full = photoPath(tenantId, file);
  if (full) await fs.unlink(full).catch(() => {});
}

module.exports = { savePhoto, photoPath, removePhoto, isPhotoName, MAX_BYTES };
