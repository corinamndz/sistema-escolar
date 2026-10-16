const { z } = require('zod');
const service = require('./notificationPreferences.service');
const { asyncHandler } = require('../../utils/asyncHandler');

/** GET /tenant/notification-preferences — matriz evento × canal y estado del correo. */
const get = asyncHandler(async (req, res) => res.status(200).json(await service.getMatrix(req.db, req.tenantId)));

/** PUT /tenant/notification-preferences — { preferences: [{ event, channel: 'bell' | 'email', enabled }] } (una o varias celdas). */
const save = asyncHandler(async (req, res) => {
  const { preferences } = z
    .object({
      preferences: z
        .array(z.object({ event: z.enum(service.EVENT_KEYS), channel: z.enum(service.CHANNELS), enabled: z.boolean() }))
        .min(1, 'Indica al menos una preferencia.')
        .max(service.EVENT_KEYS.length * service.CHANNELS.length),
    })
    .parse(req.body || {});
  res.status(200).json(await service.savePreferences(req.db, req.tenantId, req.user.id, preferences));
});

module.exports = { get, save };
