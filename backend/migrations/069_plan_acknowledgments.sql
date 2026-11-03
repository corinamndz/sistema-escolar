-- =====================================================================
-- 069 · Constancia de lectura del plan de evaluación por el representante
--
-- evaluation_plan_acknowledgments: cada vez que un representante confirma
-- "He leído y acepto el plan de evaluación" de un alumno suyo. Es la
-- constancia para Dirección (quién, de qué alumno, qué plan, cuándo, desde qué
-- IP y navegador) y por eso:
--   - NO se modifica: un trigger rechaza cualquier UPDATE (los registros solo
--     se agregan; se borran únicamente en cascada si se elimina el plan, el
--     alumno o el representante).
--   - Guarda QUÉ versión leyó: plan_hash (SHA-256 del contenido que vio: sus
--     actividades, ponderaciones, criterios, fechas en su sección y los temas
--     del contenido programático que evalúan) y un resumen legible (snapshot).
--     Si el docente cambia el plan después, la confirmación queda "de una
--     versión anterior" y el representante puede confirmar la nueva: cada
--     versión confirmada es un registro distinto (historial completo).
-- =====================================================================

CREATE TABLE IF NOT EXISTS evaluation_plan_acknowledgments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id          UUID NOT NULL REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id      UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ip_address       VARCHAR(64),
  user_agent       VARCHAR(300),
  plan_hash        CHAR(64) NOT NULL,
  snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- La misma versión del plan se confirma una sola vez por alumno y representante.
  UNIQUE (plan_id, student_id, guardian_id, plan_hash)
);
CREATE INDEX IF NOT EXISTS idx_plan_ack_plan ON evaluation_plan_acknowledgments (tenant_id, plan_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_ack_guardian ON evaluation_plan_acknowledgments (guardian_id, student_id, plan_id);

ALTER TABLE evaluation_plan_acknowledgments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON evaluation_plan_acknowledgments;
CREATE POLICY tenant_isolation ON evaluation_plan_acknowledgments USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Constancia inalterable: ningún UPDATE (ni desde la aplicación ni a mano).
CREATE OR REPLACE FUNCTION fn_plan_ack_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las confirmaciones de lectura no se pueden modificar.' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_ack_immutable ON evaluation_plan_acknowledgments;
CREATE TRIGGER trg_plan_ack_immutable BEFORE UPDATE ON evaluation_plan_acknowledgments
  FOR EACH ROW EXECUTE FUNCTION fn_plan_ack_immutable();
