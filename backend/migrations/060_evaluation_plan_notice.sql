-- =====================================================================
-- 060 · Aviso a las familias al aprobarse un plan de evaluación
--
-- Nuevo evento de la matriz de avisos (Configuración → Notificaciones):
--   evaluation_plan   "Plan de evaluación publicado": cuando coordinación
--                     aprueba un plan, a los representantes de los alumnos
--                     inscritos en sus secciones (campana y, si se activa, correo).
-- =====================================================================

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
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting', 'evaluation_plan'));
