const { z } = require('zod');
const service = require('./support.service');
const { asyncHandler } = require('../../utils/asyncHandler');

const uuid = z.string().uuid();
const emptyToUndefined = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

/** Quien reporta: nombre y correo de su usuario (el token solo trae el id). */
async function reporter(req) {
  const u = await req.db('users').where({ id: req.user.id, tenant_id: req.tenantId }).first('id', 'full_name', 'username');
  return { id: req.user.id, fullName: u?.full_name || null, email: u?.username || null };
}

/** GET /support/options — categorías, prioridades y estados con su etiqueta. */
const options = asyncHandler(async (req, res) => {
  const list = (obj) => Object.entries(obj).map(([key, label]) => ({ key, label }));
  res.status(200).json({ categories: list(service.CATEGORIES), priorities: list(service.PRIORITIES), statuses: list(service.STATUSES) });
});

const list = asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(Object.keys(service.STATUSES)).optional() }).parse(req.query);
  res.status(200).json(await service.listTickets(req.db, req.tenantId, { status }));
});

const getOne = asyncHandler(async (req, res) => {
  res.status(200).json(await service.getTicket(req.db, req.tenantId, uuid.parse(req.params.id)));
});

/** POST /support/tickets — multipart/form-data (adjunto opcional en `attachment`) o JSON. */
const create = asyncHandler(async (req, res) => {
  const data = z
    .object({
      category: z.enum(Object.keys(service.CATEGORIES), { errorMap: () => ({ message: 'Elige la categoría.' }) }),
      priority: z.enum(Object.keys(service.PRIORITIES)).default('normal'),
      subject: z.string().trim().min(5, 'Escribe un asunto (mínimo 5 caracteres).').max(150, 'Máximo 150 caracteres.'),
      description: z.string().trim().min(20, 'Describe el problema con más detalle (mínimo 20 caracteres).').max(5000, 'Máximo 5000 caracteres.'),
      pageUrl: emptyToUndefined(z.string().trim().max(300)),
    })
    .parse(req.body || {});
  res.status(201).json(await service.createTicket(req.db, req.tenantId, await reporter(req), data, req.file || null, req.get('user-agent')));
});

const reply = asyncHandler(async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(2, 'Escribe tu mensaje.').max(5000) }).parse(req.body || {});
  res.status(201).json(await service.addMessage(req.db, req.tenantId, await reporter(req), uuid.parse(req.params.id), body));
});

/** GET /support/tickets/:id/attachment — se muestra en el navegador (privado, sin caché). */
const attachment = asyncHandler(async (req, res) => {
  const file = await service.getAttachment(req.db, req.tenantId, uuid.parse(req.params.id));
  res.set({ 'Content-Type': file.mime, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'Cache-Control': 'private, no-store' });
  res.send(file.data);
});

module.exports = { options, list, getOne, create, reply, attachment };
