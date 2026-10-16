-- =====================================================================
-- 031 · Notificaciones (campana)
--
--   notifications        una notificación del colegio para un público:
--     type               p. ej. 'bcv_rate' (nueva tasa del BCV)
--     title / body       texto que se muestra en la campana
--     data               datos para el detalle (tasa, fecha valor, enlaces…)
--     audience           a quién va: {staff} (quien administra pagos),
--                        {guardians} (representantes) o ambos
--     dedupe_key         evita duplicados (la misma tasa no se notifica dos
--                        veces aunque la tarea corra varias veces al día)
--
--   notification_reads   qué usuario leyó qué notificación (una sola fila
--                        por notificación, no una copia por destinatario)
-- =====================================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  title       VARCHAR(150) NOT NULL,
  body        VARCHAR(500) NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience    TEXT[] NOT NULL CHECK (cardinality(audience) > 0 AND audience <@ ARRAY['staff', 'guardians']::text[]),
  dedupe_key  VARCHAR(150),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_notifications_tenant_recent ON notifications (tenant_id, created_at DESC);

CREATE TABLE notification_reads (
  notification_id  UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX idx_notification_reads_user ON notification_reads (tenant_id, user_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_reads USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
