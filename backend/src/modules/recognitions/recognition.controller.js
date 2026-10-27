const { z } = require('zod');
const service = require('./recognition.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD).');
const category = z.enum(service.CATEGORY_KEYS, { errorMap: () => ({ message: 'Elige la categoría del reconocimiento.' }) });
const fields = {
  category,
  title: z.string().trim().min(3, 'Escribe el título del reconocimiento.').max(120, 'Máximo 120 caracteres.'),
  message: z.string().trim().min(10, 'Cuéntale a la familia el motivo (mínimo 10 caracteres).').max(800, 'Máximo 800 caracteres.'),
  awardedOn: date,
};

/** GET /recognitions?studentId=&category=&q= */
const list = asyncHandler(async (req, res) => {
  const query = z.object({ studentId: uuid.optional(), category: category.optional(), q: z.string().trim().max(100).optional() }).parse(req.query);
  res.status(200).json(await service.listRecognitions(req, query));
});

/** GET /recognitions/options — categorías y alumnos que el usuario puede reconocer. */
const options = asyncHandler(async (req, res) => {
  res.status(200).json({
    categories: service.CATEGORY_KEYS.map((key) => ({ key, ...service.CATEGORIES[key] })),
    students: await service.studentOptions(req),
  });
});

/** POST /recognitions — { studentId, category, title, message, awardedOn } */
const create = asyncHandler(async (req, res) => {
  const data = z.object({ studentId: uuid, ...fields }).parse(req.body || {});
  // No en el futuro (hora de Venezuela de la base de datos).
  const { rows } = await req.db.raw('SELECT ?::date > current_date AS future', [data.awardedOn]);
  if (rows[0].future) return res.status(400).json({ error: { message: 'La fecha no puede ser futura.', details: [{ path: 'awardedOn', message: 'Fecha futura.' }] } });
  return res.status(201).json(await service.createRecognition(req, data));
});

const update = asyncHandler(async (req, res) => {
  const data = z.object(fields).partial().parse(req.body || {});
  res.status(200).json(await service.updateRecognition(req, uuid.parse(req.params.id), data));
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteRecognition(req, uuid.parse(req.params.id));
  res.status(204).send();
});

/** Envía un PDF para ver o descargar (privado, sin caché). */
function sendPdf(res, { buffer, filename }) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
}

/** GET /recognitions/:id/certificate — certificado en PDF. */
const certificate = asyncHandler(async (req, res) => sendPdf(res, await service.certificateForStaff(req, uuid.parse(req.params.id))));

module.exports = { list, options, create, update, remove, certificate, sendPdf };
