-- =====================================================================
-- 063 · Recordatorios automáticos: eventos, citas y pagos vencidos
--
-- Ajustes de tiempo del colegio (Configuración → Notificaciones), junto a
-- evaluation_reminder_days (062). Los procesa la tarea diaria
-- (src/jobs/dailyRemindersJob.js):
--
--   event_reminder_days     recordar cada evento de la cartelera N días antes
--                           (0 = sin recordatorio)
--   meeting_reminder_days   recordar cada cita con padres pendiente o confirmada
--                           N días antes (0 = sin recordatorio)
--   overdue_interval_days   pagos vencidos: un recordatorio cada N días mientras
--                           la cuota siga impaga
--   overdue_max_reminders   … hasta N recordatorios por cuota
--
-- payment_reminders: cada recordatorio enviado por cuota (cuántos van y cuándo
-- fue el último). Un aviso puede agrupar varias cuotas de la misma familia.
--
-- Nuevo aviso de la matriz: payment_overdue ("Pagos vencidos / deudas pendientes").
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS event_reminder_days    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meeting_reminder_days  SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overdue_interval_days  SMALLINT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS overdue_max_reminders  SMALLINT NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_settings_reminder_ranges' AND conrelid = 'tenant_settings'::regclass) THEN
    ALTER TABLE tenant_settings ADD CONSTRAINT ck_tenant_settings_reminder_ranges CHECK (
      event_reminder_days BETWEEN 0 AND 14
      AND meeting_reminder_days BETWEEN 0 AND 7
      AND overdue_interval_days BETWEEN 1 AND 30
      AND overdue_max_reminders BETWEEN 1 AND 10
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_reminders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id       UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  notification_id  UUID REFERENCES notifications(id) ON DELETE SET NULL,
  reminder_number  SMALLINT NOT NULL,
  sent_on          DATE NOT NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (payment_id, reminder_number)
);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_payment ON payment_reminders (tenant_id, payment_id, sent_on DESC);

ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_reminders;
CREATE POLICY tenant_isolation ON payment_reminders USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notification_preferences'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE notification_preferences DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE notification_preferences
  ADD CONSTRAINT ck_notification_preferences_event_type
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting', 'evaluation_plan', 'evaluation_reminder', 'payment_overdue'));
