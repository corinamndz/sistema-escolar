const service = require('./import.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { fixFilenameEncoding } = require('../../services/storage/paymentProofStorage');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** GET /imports/:type/template → descarga la plantilla .xlsx */
const downloadTemplate = asyncHandler(async (req, res) => {
  const { buffer, fileName } = await service.generateTemplate(req.db, req.tenantId, req.params.type, req.query, {
    permissions: req.permissions,
  });
  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.status(200).send(buffer);
});

function readUpload(req) {
  if (!req.file) throw ApiError.badRequest('Adjunta el archivo Excel (.xlsx) o CSV.', [{ path: 'file', message: 'Falta el archivo.' }]);
  return {
    buffer: req.file.buffer,
    originalName: fixFilenameEncoding(req.file.originalname),
    // El plan de evaluación (calificaciones) puede venir en la query o en el form.
    params: { ...req.query, ...req.body },
    // Los deja `requirePermission` (ver import.routes.js).
    actor: { permissions: req.permissions },
  };
}

/** POST /imports/:type/validate → solo valida y devuelve el reporte (no guarda nada). */
const validate = asyncHandler(async (req, res) => {
  res.status(200).json(await service.runImport(req.db, req.tenantId, req.params.type, { ...readUpload(req), commit: false }));
});

/** POST /imports/:type → valida e importa las filas válidas. */
const importFile = asyncHandler(async (req, res) => {
  res.status(200).json(await service.runImport(req.db, req.tenantId, req.params.type, { ...readUpload(req), commit: true }));
});

module.exports = { downloadTemplate, validate, importFile };
