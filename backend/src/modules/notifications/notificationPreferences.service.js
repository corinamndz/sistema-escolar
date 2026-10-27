const { ApiError } = require('../../utils/ApiError');
const mailer = require('../../services/email/mailer');

/**
 * Matriz de avisos (Configuración → Notificaciones): por cada evento, si sale
 * por la CAMPANA del sistema y/o por CORREO. Todo disparador consulta
 * `isEnabled` antes de emitir. Sin fila guardada vale el predeterminado.
 */
const CATALOG = [
  {
    key: 'bcv_rate',
    label: 'Nueva tasa BCV',
    description: 'Cuando se actualiza la tasa oficial del dólar (automática o manualmente).',
    recipients: 'Todas las familias (y la administración, en la campana)',
    defaults: { bell: true, email: false },
  },
  {
    key: 'payment_confirmed',
    label: 'Pago confirmado',
    description: 'Cuando la administración confirma un pago. Por correo va el comprobante en PDF.',
    recipients: 'El representante del pago',
    defaults: { bell: true, email: true },
  },
  {
    key: 'payment_overdue',
    label: 'Pagos vencidos / deudas pendientes',
    description: 'Recordatorio automático (tarea diaria) a la familia con cuotas vencidas sin pagar ni reportar: uno por familia con todas sus cuotas. Se repite cada cierto número de días hasta un máximo por cuota.',
    recipients: 'El representante responsable de cada cuota',
    // Desactivado hasta que el colegio lo active: al encenderlo avisa a todas las familias con deuda.
    defaults: { bell: false, email: false },
  },
  {
    key: 'school_event',
    label: 'Eventos y cartelera',
    description: 'Al publicar un evento (asambleas, actos culturales…) o cambiarle la fecha u hora. Opcional: un recordatorio automático unos días antes.',
    recipients: 'Las familias a las que va dirigido el evento',
    defaults: { bell: true, email: false },
  },
  {
    key: 'sanction',
    label: 'Sanciones de convivencia',
    description: 'Cuando se registra una sanción o amonestación a un alumno.',
    recipients: 'Los representantes del alumno',
    defaults: { bell: true, email: false },
  },
  {
    key: 'recognition',
    label: 'Reconocimientos',
    description: 'Cuando un docente o la dirección otorga un reconocimiento a un alumno (excelencia, esfuerzo, conducta…). Se muestra con un diseño de celebración.',
    recipients: 'Los representantes del alumno',
    defaults: { bell: true, email: true },
  },
  {
    key: 'parent_meeting',
    label: 'Citas con padres',
    description: 'Al agendar una cita, o cambiarle la fecha, la hora o el estado. Son los canales que vienen marcados en cada cita (se pueden cambiar al crearla). Opcional: un recordatorio automático unos días antes, por los canales de la cita.',
    recipients: 'El representante citado',
    defaults: { bell: true, email: true },
  },
  {
    key: 'evaluation_plan',
    label: 'Plan de evaluación publicado',
    description: 'Cuando coordinación aprueba el plan de evaluación de una materia: ya se ve en el portal con sus evaluaciones y fechas.',
    recipients: 'Los representantes de los alumnos de las secciones del plan',
    defaults: { bell: true, email: false },
  },
  {
    key: 'evaluation_reminder',
    label: 'Recordatorio de evaluación próxima',
    description: 'Aviso automático (tarea diaria) unos días antes de cada evaluación de los planes publicados. Elige con cuánta anticipación.',
    recipients: 'Los representantes de cada alumno de la sección',
    defaults: { bell: true, email: false },
  },
  {
    key: 'club_enrollment',
    label: 'Inscripción en clubes',
    description: 'Cuando se inscribe a un alumno en un club o actividad extracurricular.',
    recipients: 'Los representantes del alumno',
    defaults: { bell: true, email: false },
  },
];
const EVENT_KEYS = CATALOG.map((e) => e.key);
const CHANNELS = ['bell', 'email'];

let ready = false;
async function hasTable(trx) {
  if (ready) return true;
  const { rows } = await trx.raw("SELECT to_regclass('notification_preferences') IS NOT NULL AS ok");
  ready = rows[0].ok;
  return ready;
}

async function storedMap(trx, tenantId) {
  if (!(await hasTable(trx))) return new Map();
  const rows = await trx('notification_preferences').where({ tenant_id: tenantId }).select('event_type', 'channel', 'enabled');
  return new Map(rows.map((r) => [`${r.event_type}:${r.channel}`, r.enabled]));
}

/** ¿Sale el aviso `event` por el canal `channel`? (predeterminado si no hay fila). */
async function isEnabled(trx, tenantId, event, channel) {
  const def = CATALOG.find((e) => e.key === event)?.defaults[channel] ?? false;
  if (!(await hasTable(trx))) return def;
  const row = await trx('notification_preferences').where({ tenant_id: tenantId, event_type: event, channel }).first('enabled');
  return row ? row.enabled : def;
}

/** ¿El colegio puede enviar correos ahora? (configuración propia activa o el SMTP general). */
async function emailStatus(trx, tenantId) {
  try {
    const cfg = await mailer.resolveMailConfig(trx, tenantId);
    return { ready: Boolean(cfg && cfg.enabled), source: cfg?.source || null };
  } catch {
    return { ready: false, source: 'tenant' };
  }
}

/**
 * Ajustes de tiempo de los recordatorios automáticos (tenant_settings,
 * migraciones 062 y 063), cada uno ligado a su fila de la matriz. 0 = sin
 * recordatorio (solo donde `min` es 0). Los usa la tarea diaria (dailyRemindersJob).
 */
const REMINDER_SETTINGS = {
  evaluationReminderDays: { column: 'evaluation_reminder_days', event: 'evaluation_reminder', min: 1, max: 7, default: 1 },
  eventReminderDays: { column: 'event_reminder_days', event: 'school_event', min: 0, max: 14, default: 0 },
  meetingReminderDays: { column: 'meeting_reminder_days', event: 'parent_meeting', min: 0, max: 7, default: 0 },
  overdueIntervalDays: { column: 'overdue_interval_days', event: 'payment_overdue', min: 1, max: 30, default: 7 },
  overdueMaxReminders: { column: 'overdue_max_reminders', event: 'payment_overdue', min: 1, max: 10, default: 3 },
};
const SETTING_KEYS = Object.keys(REMINDER_SETTINGS);

/** { evaluationReminderDays, eventReminderDays, … } del colegio (predeterminados si no hay fila). */
async function reminderSettings(trx, tenantId) {
  const row = (await trx('tenant_settings').where({ tenant_id: tenantId }).first(SETTING_KEYS.map((k) => REMINDER_SETTINGS[k].column))) || {};
  return Object.fromEntries(
    SETTING_KEYS.map((k) => {
      const v = row[REMINDER_SETTINGS[k].column];
      return [k, v === null || v === undefined ? REMINDER_SETTINGS[k].default : Number(v)];
    })
  );
}

/** Con cuántos días de anticipación se recuerda cada evaluación (1 = el día anterior). */
async function evaluationReminderDays(trx, tenantId) {
  return (await reminderSettings(trx, tenantId)).evaluationReminderDays;
}

/** GET: la matriz completa con el estado del correo y los ajustes de tiempo (con sus rangos). */
async function getMatrix(trx, tenantId) {
  const stored = await storedMap(trx, tenantId);
  const value = (e, ch) => (stored.has(`${e.key}:${ch}`) ? stored.get(`${e.key}:${ch}`) : e.defaults[ch]);
  return {
    events: CATALOG.map((e) => ({ key: e.key, label: e.label, description: e.description, recipients: e.recipients, bell: value(e, 'bell'), email: value(e, 'email') })),
    email: await emailStatus(trx, tenantId),
    settings: await reminderSettings(trx, tenantId),
    settingsRanges: Object.fromEntries(SETTING_KEYS.map((k) => [k, { min: REMINDER_SETTINGS[k].min, max: REMINDER_SETTINGS[k].max }])),
  };
}

/** PUT: guarda uno o varios ajustes de tiempo ({ eventReminderDays: 2, … }), ya validados. */
async function saveReminderSettings(trx, tenantId, values) {
  const patch = Object.fromEntries(Object.entries(values).map(([k, v]) => [REMINDER_SETTINGS[k].column, v]));
  if (!Object.keys(patch).length) return;
  await trx('tenant_settings')
    .insert({ tenant_id: tenantId, ...patch, updated_at: trx.fn.now() })
    .onConflict('tenant_id')
    .merge({ ...patch, updated_at: trx.fn.now() });
}

/** PUT: guarda una o varias celdas de la matriz. */
async function savePreferences(trx, tenantId, userId, preferences) {
  for (const p of preferences) {
    if (!EVENT_KEYS.includes(p.event) || !CHANNELS.includes(p.channel)) {
      throw ApiError.badRequest(`Aviso o canal desconocido: ${p.event} / ${p.channel}.`);
    }
  }
  if (preferences.length) {
    await trx('notification_preferences')
      .insert(preferences.map((p) => ({ tenant_id: tenantId, event_type: p.event, channel: p.channel, enabled: p.enabled, updated_by: userId, updated_at: trx.fn.now() })))
      .onConflict(['tenant_id', 'event_type', 'channel'])
      .merge(['enabled', 'updated_by', 'updated_at']);
  }
  return getMatrix(trx, tenantId);
}

module.exports = { CATALOG, EVENT_KEYS, CHANNELS, REMINDER_SETTINGS, SETTING_KEYS, isEnabled, getMatrix, savePreferences, reminderSettings, saveReminderSettings, evaluationReminderDays, emailStatus };
