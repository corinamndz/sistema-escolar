const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { ApiError } = require('../../utils/ApiError');

/**
 * Comprobantes (soportes) de pago: imágenes JPG/PNG o PDF.
 *
 *   backend/storage/payment-proofs/<tenantId>/<uuid>.<ext>
 *
 * PRIVADOS: esta carpeta NO se sirve como estática (a diferencia de los logos).
 * Se descargan solo por GET /api/payments/:id/proof, que verifica permisos.
 * En la base se guarda la ruta relativa a `storage/`.
 */
const STORAGE_ROOT = path.join(__dirname, '..', '..', '..', 'storage');
const PROOFS_DIR = path.join(STORAGE_ROOT, 'payment-proofs');

const TYPES = {
  png: { ext: 'png', mime: 'image/png' },
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

/**
 * Tipo real según la firma binaria (no la extensión ni el mimetype del
 * navegador, que se pueden falsificar): así un .html renombrado a .pdf no pasa.
 */
function detectProofType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return TYPES.png;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return TYPES.jpg;
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return TYPES.pdf;
  return null;
}

/**
 * multer (busboy) decodifica el nombre del archivo como latin1, pero los
 * navegadores lo envían en UTF-8: "Pago Móvil ñ.pdf" llega como "Pago MÃ³vil Ã±.pdf".
 * Se reinterpreta como UTF-8 solo si el resultado es válido (sin U+FFFD); un
 * nombre ASCII queda idéntico.
 */
function fixFilenameEncoding(name) {
  const decoded = Buffer.from(String(name), 'latin1').toString('utf8');
  return decoded.includes('�') ? String(name) : decoded;
}

/** Nombre original "limpio" para mostrar y para Content-Disposition. */
function sanitizeName(name = '') {
  const base = path
    .basename(fixFilenameEncoding(name))
    .replace(/[^\w.\- ()áéíóúüÁÉÍÓÚÜñÑ]/g, '_')
    .slice(0, 120);
  return base || 'comprobante';
}

/** Valida y guarda el archivo. Devuelve los datos a persistir en `payments`. */
async function saveProof(tenantId, { buffer, originalname }) {
  const type = detectProofType(buffer);
  if (!type) {
    throw ApiError.badRequest('El comprobante debe ser una imagen JPG/PNG o un PDF válido.', [
      { path: 'proof', message: 'Formato no permitido. Usa JPG, PNG o PDF.' },
    ]);
  }
  const dir = path.join(PROOFS_DIR, String(tenantId));
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return {
    proof_path: path.posix.join('payment-proofs', String(tenantId), fileName),
    proof_mime: type.mime,
    proof_original_name: sanitizeName(originalname),
    proof_size: buffer.length,
  };
}

/** Ruta absoluta verificada (nunca fuera de storage/payment-proofs). */
function resolveProof(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('payment-proofs/')) return null;
  const absolute = path.resolve(STORAGE_ROOT, relativePath);
  return absolute.startsWith(PROOFS_DIR + path.sep) ? absolute : null;
}

async function deleteProof(relativePath) {
  const absolute = resolveProof(relativePath);
  if (!absolute) return;
  try {
    await fs.unlink(absolute);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('No se pudo borrar el comprobante', relativePath, err.message);
  }
}

module.exports = { PROOFS_DIR, detectProofType, saveProof, resolveProof, deleteProof, sanitizeName, fixFilenameEncoding };
