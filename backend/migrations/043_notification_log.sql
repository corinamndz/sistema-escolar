-- =====================================================================
-- 043 · Log de notificaciones
--
-- Historial de todo lo que el colegio envía, para consultarlo y reenviarlo:
--   - campana          tabla notifications (ya existente)
--   - avisos por correo  tabla email_outbox (ya existente: cola con estado)
--   - correos directos  NUEVA tabla mail_log: los que no pasan por la cola
--                       (credenciales de acceso, comprobante de pago en PDF).
--                       No guarda el cuerpo: las credenciales llevan una
--                       contraseña temporal y el comprobante se regenera.
--
-- `resend_of` enlaza cada reenvío con el registro original.
--
-- Además corrige el CHECK de notification_preferences.event_type, que no
-- admitía el aviso de citas con padres (migración 042).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Matriz de avisos: admitir 'parent_meeting'
-- ---------------------------------------------------------------------
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
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting'));

-- ---------------------------------------------------------------------
-- Correos directos
-- ---------------------------------------------------------------------
CREATE TABLE mail_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        VARCHAR(30) NOT NULL CHECK (kind IN ('credentials', 'payment_receipt')),
  to_email    VARCHAR(255) NOT NULL,
  to_name     VARCHAR(200),
  subject     VARCHAR(300) NOT NULL,
  status      VARCHAR(10) NOT NULL CHECK (status IN ('sent', 'failed')),
  error       VARCHAR(500),
  ref_id      UUID,            -- payment_receipt: el pago
  resend_of   UUID REFERENCES mail_log(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mail_log_tenant ON mail_log (tenant_id, created_at DESC);

ALTER TABLE mail_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mail_log USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- Reenvíos de la cola y de la campana
-- ---------------------------------------------------------------------
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS resend_of UUID REFERENCES email_outbox(id) ON DELETE SET NULL;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_email_outbox_tenant_created ON email_outbox (tenant_id, created_at DESC);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resend_of UUID REFERENCES notifications(id) ON DELETE SET NULL;
