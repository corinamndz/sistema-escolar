-- =====================================================================
-- 062 · Recordatorio de evaluación próxima
--
-- Nuevo aviso automático de la matriz (Configuración → Notificaciones):
--   evaluation_reminder   una tarea diaria (src/jobs/evaluationReminderJob.js)
--                         avisa a los representantes de cada alumno N días antes
--                         de cada evaluación de los planes publicados.
--
-- tenant_settings.evaluation_reminder_days   con cuántos días de anticipación
--   (1 a 7; 1 = el día anterior). Lo elige el colegio en la misma fila del aviso.
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS evaluation_reminder_days SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_settings_evaluation_reminder_days' AND conrelid = 'tenant_settings'::regclass) THEN
    ALTER TABLE tenant_settings
      ADD CONSTRAINT ck_tenant_settings_evaluation_reminder_days CHECK (evaluation_reminder_days BETWEEN 1 AND 7);
  END IF;
END $$;

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
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting', 'evaluation_plan', 'evaluation_reminder'));
