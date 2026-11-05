const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');

/**
 * Imágenes insertadas en los comunicados (infografías, carteles, logos).
 *
 * storage/announcements/<tenantId>/<uuid>.<ext>, servidas como estáticas en
 * /storage/announcements (ver app.js): igual que los logos, el nombre es un
 * UUID no adivinable y la imagen la ve cualquiera que reciba el comunicado.
 *
 * El tipo se decide por la FIRMA binaria (magic bytes), no por la extensión ni
 * el mimetype que declara el navegador: un .svg o .html renombrado nunca se
 * guarda. SVG no se admite (puede llevar scripts).
 */
const BASE_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'announcements');
const PUBLIC_PREFIX = '/storage/announcements';
const MAX_BYTES = 3 * 1024 * 1024;

function detectImageType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/** Guarda la imagen validada → URL relativa pública: /storage/announcements/<tenant>/<uuid>.<ext>. */
async function saveAnnouncementImage(tenantId, buffer) {
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

/** ¿`src` es una imagen guardada por este módulo? (para el saneado del comunicado) */
const STORED_SRC = /^\/storage\/announcements\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i;
const isStoredAnnouncementImage = (src) => STORED_SRC.test(String(src || ''));

module.exports = { saveAnnouncementImage, isStoredAnnouncementImage, BASE_DIR, MAX_BYTES };
