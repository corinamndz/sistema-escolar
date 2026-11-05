const multer = require('multer');
const { ApiError } = require('../utils/ApiError');

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_MIMES = ['image/png', 'image/jpeg', 'image/jpg'];

/**
 * Recibe el campo `logo` de un multipart/form-data en memoria (`req.file.buffer`).
 * Se guarda en memoria y no directo a disco para poder validar la firma
 * binaria antes de escribir nada (ver services/storage/logoStorage.js).
 * El filtro por mimetype aquí es solo un primer corte rápido.
 */
const logoMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_LOGO_MIMES.includes(file.mimetype)) return cb(null, true);
    return cb(
      ApiError.badRequest('El logo debe ser una imagen PNG o JPG.', [
        { path: 'logo', message: 'Formato no permitido. Usa PNG o JPG.' },
      ])
    );
  },
}).single('logo');

/** Envuelve multer para traducir sus errores al formato `{ error: { message, details } }` del API. */
function logoUpload(req, res, next) {
  logoMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'El logo no puede pesar más de 2 MB.'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Solo se permite un archivo en el campo "logo".'
            : 'No se pudo procesar el archivo subido.';
      return next(ApiError.badRequest(message, [{ path: 'logo', message }]));
    }
    return next(err);
  });
}

// ---------------------------------------------------------------------------
// Comprobante de pago (campo `proof`, OPCIONAL): JPG, PNG o PDF de hasta 5 MB.
// En memoria para validar la firma binaria antes de escribir en disco
// (ver services/storage/paymentProofStorage.js).
// ---------------------------------------------------------------------------

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];

const proofMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_PROOF_MIMES.includes(file.mimetype)) return cb(null, true);
    return cb(
      ApiError.badRequest('El comprobante debe ser una imagen JPG/PNG o un PDF.', [
        { path: 'proof', message: 'Formato no permitido. Usa JPG, PNG o PDF.' },
      ])
    );
  },
}).single('proof');

function proofUpload(req, res, next) {
  proofMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'El comprobante no puede pesar más de 5 MB.'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Solo se permite un archivo en el campo "proof".'
            : 'No se pudo procesar el archivo subido.';
      return next(ApiError.badRequest(message, [{ path: 'proof', message }]));
    }
    return next(err);
  });
}

// ---------------------------------------------------------------------------
// Carga masiva (campo `file`): plantilla Excel .xlsx o CSV de hasta 5 MB.
// Se filtra por extensión porque el mimetype de un CSV varía según el sistema
// (text/csv, application/vnd.ms-excel, text/plain…); el contenido real se
// valida al leerlo (firma ZIP del .xlsx o texto sin bytes nulos).
// ---------------------------------------------------------------------------

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const importMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|csv)$/i.test(file.originalname)) return cb(null, true);
    return cb(
      ApiError.badRequest('Sube la plantilla en formato Excel (.xlsx) o CSV.', [
        { path: 'file', message: 'Formato no permitido. Usa .xlsx o .csv.' },
      ])
    );
  },
}).single('file');

function importUpload(req, res, next) {
  importMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo no puede pesar más de 5 MB.'
          : err.code === 'LIMIT_UNEXPECTED_FILE'
            ? 'Solo se permite un archivo en el campo "file".'
            : 'No se pudo procesar el archivo subido.';
      return next(ApiError.badRequest(message, [{ path: 'file', message }]));
    }
    return next(err);
  });
}

// ---------------------------------------------------------------------------
// Adjunto de un ticket de soporte (campo `attachment`, OPCIONAL): captura
// JPG/PNG o PDF de hasta 5 MB, en memoria (se guarda en la base; la firma
// binaria la valida support.service).
// ---------------------------------------------------------------------------

const supportMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_PROOF_MIMES.includes(file.mimetype)) return cb(null, true);
    return cb(ApiError.badRequest('Adjunta una captura JPG/PNG o un PDF.', [{ path: 'attachment', message: 'Formato no permitido. Usa JPG, PNG o PDF.' }]));
  },
}).single('attachment');

function supportUpload(req, res, next) {
  supportMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'El adjunto no puede pesar más de 5 MB.' : 'No se pudo procesar el archivo adjunto.';
      return next(ApiError.badRequest(message, [{ path: 'attachment', message }]));
    }
    return next(err);
  });
}

// ---------------------------------------------------------------------------
// Imagen de un comunicado (campo `image`): PNG, JPG, GIF o WebP de hasta 3 MB.
// En memoria para validar la firma binaria antes de escribir en disco
// (ver services/storage/announcementImageStorage.js).
// ---------------------------------------------------------------------------

const MAX_ANNOUNCEMENT_IMAGE_BYTES = 3 * 1024 * 1024;
const announcementImageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ANNOUNCEMENT_IMAGE_BYTES, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    return cb(ApiError.badRequest('La imagen debe ser PNG, JPG, GIF o WebP.', [{ path: 'image', message: 'Formato no permitido.' }]));
  },
}).single('image');

function announcementImageUpload(req, res, next) {
  announcementImageMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof ApiError) return next(err);
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 3 MB.' : 'No se pudo procesar la imagen.';
      return next(ApiError.badRequest(message, [{ path: 'image', message }]));
    }
    return next(err);
  });
}

module.exports = { logoUpload, MAX_LOGO_BYTES, proofUpload, MAX_PROOF_BYTES, importUpload, MAX_IMPORT_BYTES, supportUpload, announcementImageUpload };
