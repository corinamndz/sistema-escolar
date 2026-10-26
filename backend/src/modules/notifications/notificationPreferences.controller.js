const { z } = require('zod');
const service = require('./notificationPreferences.service');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/ApiError');

/** GET /tenant/notification-preferences — matriz evento × canal, estado del correo y ajustes de tiempo. */
const get = asyncHandler(async (req, res) => res.status(200).json(await service.getMatrix(req.db, req.tenantId)));

// Cada ajuste de tiempo con su rango (notificationPreferences.service → REMINDER_SETTINGS).
const settingsSchema = z
  .object(
    Object.fromEntries(
      service.SETTING_KEYS.map((key) => {
        const { min, max } = service.REMINDER_SETTINGS[key];
        return [key, z.coerce.number().int().min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`).optional()];
      })
    )
  )
  .strict();

/**
 * PUT /tenant/notification-preferences
 *   { preferences?: [{ event, channel: 'bell' | 'email', enabled }],
 *     settings?: { evaluationReminderDays?, eventReminderDays?, meetingReminderDays?, overdueIntervalDays?, overdueMaxReminders? },
 *     evaluationReminderDays? }   ← forma anterior, equivale a settings.evaluationReminderDays
 * Una o varias celdas de la matriz y/o ajustes de tiempo de los recordatorios.
 */
const save = asyncHandler(async (req, res) => {
  const body = z
    .object({
      preferences: z
        .array(z.object({ event: z.enum(service.EVENT_KEYS), channel: z.enum(service.CHANNELS), enabled: z.boolean() }))
        .max(service.EVENT_KEYS.length * service.CHANNELS.length)
        .optional(),
      settings: settingsSchema.optional(),
      evaluationReminderDays: settingsSchema.shape.evaluationReminderDays,
    })
    .parse(req.body || {});
  const settings = Object.fromEntries(
    Object.entries({ ...(body.evaluationReminderDays !== undefined ? { evaluationReminderDays: body.evaluationReminderDays } : {}), ...(body.settings || {}) }).filter(([, v]) => v !== undefined)
  );
  const preferences = body.preferences || [];
  if (!preferences.length && !Object.keys(settings).length) {
    throw ApiError.badRequest('Indica al menos una preferencia o ajuste.');
  }
  await service.saveReminderSettings(req.db, req.tenantId, settings);
  res.status(200).json(await service.savePreferences(req.db, req.tenantId, req.user.id, preferences));
});

module.exports = { get, save };
