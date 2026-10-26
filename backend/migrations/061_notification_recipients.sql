-- =====================================================================
-- 061 · Trazabilidad de lectura de las notificaciones
--
-- Una notificación se guarda UNA vez con su público (staff / guardians /
-- users, migraciones 031, 036 y 059) y quién la ve se calcula al consultar.
-- Para auditar la lectura hace falta saber a QUIÉN se envió en ese momento:
--
--   notification_recipients  foto de los destinatarios al crearse el aviso
--     sent_at   cuándo se le envió (= created_at del aviso)
--   notification_reads       (ya existía) read_at = cuándo la abrió; sin fila
--                            = pendiente de lectura
--
-- La foto la toma un trigger AFTER INSERT, así cubre todo lo que publica en
-- la campana (notify(), avisos de revisión, reenvíos del Log). Las reglas son
-- las mismas con que la campana decide quién ve cada aviso
-- (notification.service.js → visibleQuery):
--   staff      usuarios activos con lectura de Pagos (sin el rol Representante),
--              solo si el aviso no va dirigido a representantes concretos
--   guardians  representantes con usuario activo (o solo los destinatarios)
--   users      los usuarios de target_user_ids (avisos personales)
-- =====================================================================

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id  UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notification_id, user_id)
);
-- La PK sirve al reporte de un aviso; este índice, a "qué recibió este usuario".
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user ON notification_recipients (tenant_id, user_id);

ALTER TABLE notification_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_recipients;
CREATE POLICY tenant_isolation ON notification_recipients USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Hora real de cada lectura (now() es la misma para toda una transacción).
ALTER TABLE notification_reads ALTER COLUMN read_at SET DEFAULT clock_timestamp();

/** Guarda los destinatarios de los avisos indicados (idempotente). Devuelve cuántos agregó. */
CREATE OR REPLACE FUNCTION snapshot_notification_recipients(p_ids UUID[]) RETURNS INTEGER AS $$
DECLARE
  added INTEGER;
BEGIN
  INSERT INTO notification_recipients (notification_id, user_id, tenant_id, sent_at)
  SELECT DISTINCT n.id, x.user_id, n.tenant_id, n.created_at
  FROM notifications n
  CROSS JOIN LATERAL (
    -- Administración: lectura de Pagos.
    SELECT ur.user_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.tenant_id = n.tenant_id AND r.name <> 'Representante'
    JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.tenant_id = n.tenant_id AND rp.can_read
    JOIN modules m ON m.id = rp.module_id AND m.code = 'payments'
    JOIN users u ON u.id = ur.user_id AND u.status = 'active'
    WHERE 'staff' = ANY (n.audience) AND n.target_guardian_ids IS NULL
    UNION
    -- Familias: todas o solo las destinatarias.
    SELECT g.user_id
    FROM guardians g
    JOIN users u ON u.id = g.user_id AND u.status = 'active'
    WHERE 'guardians' = ANY (n.audience)
      AND g.tenant_id = n.tenant_id
      AND (n.target_guardian_ids IS NULL OR g.id = ANY (n.target_guardian_ids))
    UNION
    -- Personales.
    SELECT u.id
    FROM unnest(n.target_user_ids) AS t(uid)
    JOIN users u ON u.id = t.uid
    WHERE 'users' = ANY (n.audience)
  ) x
  WHERE n.id = ANY (p_ids)
  ON CONFLICT (notification_id, user_id) DO NOTHING;
  GET DIAGNOSTICS added = ROW_COUNT;
  RETURN added;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_notification_recipients() RETURNS TRIGGER AS $$
BEGIN
  PERFORM snapshot_notification_recipients(ARRAY[NEW.id]);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_recipients ON notifications;
CREATE TRIGGER trg_notification_recipients
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION fn_notification_recipients();

-- Avisos anteriores: no se sabe a quién se enviaron entonces; se toma como
-- destinatarios a quienes los ven hoy (y, en el reporte, a quien ya los leyó).
SELECT snapshot_notification_recipients(array_agg(n.id))
FROM notifications n
WHERE n.tenant_id IN (SELECT migration_tenant_ids());
