const { z } = require('zod');
const service = require('./activityExcel.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');
const { fixFilenameEncoding } = require('../../services/storage/paymentProofStorage');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `?sections=A,B&topic=…` → nombres de las secciones de la actividad (para sus columnas de fecha). */
const querySchema = z.object({
  sections: z
    .string()
    .max(500)
    .optional()
    .transform((s) => [...new Set((s || '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 30)),
  topic: z.string().max(200).optional(),
});

/** GET /evaluation-plans/activity-template → plantilla .xlsx de una evaluación detallada. */
const downloadTemplate = asyncHandler(async (req, res) => {
  const { sections, topic } = querySchema.parse(req.query);
  const buffer = await service.generateTemplate({ sectionNames: sections, topic });
  res.set({
    'Content-Type': XLSX_MIME,
    'Content-Disposition': 'attachment; filename="plantilla-evaluacion-detallada.xlsx"',
    'Cache-Control': 'no-store',
  });
  res.status(200).send(buffer);
});

/** POST /evaluation-plans/activity-template/parse (multipart `file`) → datos para el formulario (no guarda nada). */
const parse = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Adjunta el archivo Excel (.xlsx).', [{ path: 'file', message: 'Falta el archivo.' }]);
  const { sections } = querySchema.parse(req.query);
  res.status(200).json(await service.parseActivity(req.file.buffer, fixFilenameEncoding(req.file.originalname), { sectionNames: sections }));
});

module.exports = { downloadTemplate, parse };
