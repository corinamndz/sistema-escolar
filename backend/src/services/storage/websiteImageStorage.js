const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');

/**
 * Imágenes del mini-sitio público del colegio (portada y galería).
 *
 * storage/website/<tenantId>/<uuid>.<ext>, servidas como estáticas en
 * /storage/website (ver app.js): son públicas por naturaleza (las ve cualquier
 * visitante del sitio), con nombre UUID no adivinable.
 *
 * El tipo se decide por la FIRMA binaria, no por la extensión ni el mimetype:
 * un .svg o .html renombrado nunca se guarda. SVG no se admite (puede llevar scripts).
 */
const BASE_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'website');
const PUBLIC_PREFIX = '/storage/website';
const MAX_BYTES = 3 * 1024 * 1024;

function detectImageType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** Guarda la imagen validada → URL relativa pública: /storage/website/<tenant>/<uuid>.<ext>. */
async function saveWebsiteImage(tenantId, buffer) {
  if (!buffer?.length) throw ApiError.badRequest('Elige una imagen.', [{ path: 'image', message: 'Archivo vacío.' }]);
  if (buffer.length > MAX_BYTES) throw ApiError.badRequest('La imagen no puede pesar más de 3 MB.', [{ path: 'image', message: 'Máximo 3 MB.' }]);
  const ext = detectImageType(buffer);
  if (!ext) throw ApiError.badRequest('La imagen debe ser PNG, JPG, GIF o WebP.', [{ path: 'image', message: 'Formato no permitido.' }]);
  const dir = path.join(BASE_DIR, String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return `${PUBLIC_PREFIX}/${tenantId}/${fileName}`;
}

const STORED = /^\/storage\/website\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(png|jpg|gif|webp))$/i;

/** ¿`url` es una imagen de ESTE colegio guardada por este módulo? (no se aceptan URLs externas) */
const isOwnWebsiteImage = (tenantId, url) => {
  const m = STORED.exec(String(url || ''));
  return Boolean(m && m[1].toLowerCase() === String(tenantId).toLowerCase());
};

/**
 * Borra imágenes que el sitio dejó de usar (portada cambiada, foto quitada de la
 * galería). Se llama SOLO después de confirmar el guardado. Ignora lo que no sea
 * de este colegio y de este módulo.
 */
async function removeWebsiteImages(tenantId, urls) {
  for (const url of urls) {
    const m = STORED.exec(String(url || ''));
    if (!m || m[1].toLowerCase() !== String(tenantId).toLowerCase()) continue;
    try {
      await fs.unlink(path.join(BASE_DIR, String(tenantId), m[2]));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('No se pudo borrar la imagen del sitio', url, err);
    }
  }
}

module.exports = {
  saveWebsiteImage,
  isOwnWebsiteImage,
  removeWebsiteImages,
  BASE_DIR,
  MAX_BYTES,
};
