-- =====================================================================
-- 036 · Preferencias de notificaciones (campana / correo) y avisos dirigidos
--
--   notification_preferences   matriz evento × canal por colegio
--     event_type     bcv_rate | payment_confirmed | school_event |
--                    sanction | club_enrollment
--     channel        bell (campana del sistema) | email (correo SMTP/Google)
--     enabled        si el aviso sale por ese canal
--   Sin fila, vale el valor predeterminado del sistema
--   (notificationPreferences.service.js).
--
--   notifications.target_guardian_ids
--                  aviso solo para ESOS representantes (su pago, la sanción o
--                  el club de su hijo, un evento de su sección). NULL = todo
--                  el público de la notificación (p. ej. la tasa BCV).
--
--   email_outbox   cola de correos de avisos: se escribe en la transacción del
--                  evento y la envía una tarea en segundo plano, con
--                  reintentos (los avisos masivos no demoran la pantalla).
-- =====================================================================

CREATE TABLE notification_preferences (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type  VARCHAR(30) NOT NULL CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment')),
  channel     VARCHAR(10) NOT NULL CHECK (channel IN ('bell', 'email')),
  enabled     BOOLEAN NOT NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_type, channel)
);

ALTER TABLE notifications ADD COLUMN target_guardian_ids UUID[];
CREATE INDEX idx_notifications_targets ON notifications USING GIN (target_guardian_ids);

CREATE TABLE email_outbox (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guardian_id      UUID REFERENCES guardians(id) ON DELETE SET NULL,
  event_type       VARCHAR(30) NOT NULL,
  to_email         VARCHAR(255) NOT NULL,
  subject          VARCHAR(300) NOT NULL,
  html             TEXT NOT NULL,
  text             TEXT NOT NULL,
  status           VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at       TIMESTAMPTZ,
  error            VARCHAR(500),
  dedupe_key       VARCHAR(250),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_email_outbox_queue ON email_outbox (tenant_id, status, next_attempt_at);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_outbox USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
