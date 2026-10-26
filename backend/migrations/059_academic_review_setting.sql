-- =====================================================================
-- 059 · Revisión académica configurable y avisos dirigidos a usuarios
--
-- tenant_settings.requires_academic_review   el colegio decide si el contenido
--   programático pasa por la revisión de coordinación (058):
--     true   el docente lo envía a revisión; mientras está en revisión o
--            aprobado no lo puede editar (se lo reabre coordinación);
--     false  el docente guarda y queda publicado, sin revisión (por defecto).
--
-- notifications.target_user_ids   avisos de la campana para USUARIOS concretos
--   (coordinador del nivel, el docente que envió), con audience 'users'. Los
--   públicos anteriores (staff = Administración, guardians = familias) no
--   cambian. Los coordinadores no eran de ningún público y no veían la campana.
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS requires_academic_review BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS target_user_ids UUID[];

-- audience admite 'users' (avisos dirigidos a usuarios).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%audience%'
  LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_audience
  CHECK (cardinality(audience) > 0 AND audience <@ ARRAY['staff', 'guardians', 'users']::text[]);

-- Un aviso 'users' siempre lleva destinatarios.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_users_targets;
ALTER TABLE notifications
  ADD CONSTRAINT ck_notifications_users_targets
  CHECK (NOT ('users' = ANY(audience)) OR cardinality(target_user_ids) > 0);

CREATE INDEX IF NOT EXISTS idx_notifications_target_users ON notifications USING GIN (target_user_ids) WHERE target_user_ids IS NOT NULL;
