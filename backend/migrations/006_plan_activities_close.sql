-- =====================================================================
-- 006 — Actividades con descripción y fecha; cierre del plan de evaluación
--
-- evaluation_activities  + description, planned_date (fecha estimada)
-- evaluation_plans       + status ('open' | 'closed'), closed_at
--
-- Reglas (el servicio las valida con mensajes claros; estos triggers son la
-- red de seguridad, igual que trg_check_activity_weight_sum de 001):
--   - Un plan solo se puede CERRAR si sus actividades suman exactamente 100%.
--   - Las actividades de un plan cerrado no se pueden crear, editar ni borrar.
-- =====================================================================

ALTER TABLE evaluation_activities
  ADD COLUMN description   TEXT CHECK (description IS NULL OR length(description) <= 1000),
  ADD COLUMN planned_date  DATE;

ALTER TABLE evaluation_plans
  ADD COLUMN status     VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  ADD COLUMN closed_at  TIMESTAMPTZ;

-- Cerrar exige 100% exacto.
CREATE OR REPLACE FUNCTION fn_check_plan_close() RETURNS TRIGGER AS $$
DECLARE
  total NUMERIC(6,2);
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    SELECT COALESCE(SUM(weight_percent), 0) INTO total
    FROM evaluation_activities WHERE evaluation_plan_id = NEW.id;
    IF total <> 100 THEN
      RAISE EXCEPTION 'No se puede cerrar el plan: sus actividades suman % por ciento y deben sumar exactamente 100.', total
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_plan_close
  BEFORE UPDATE OF status ON evaluation_plans
  FOR EACH ROW EXECUTE FUNCTION fn_check_plan_close();

-- Actividades de un plan cerrado: bloqueadas.
CREATE OR REPLACE FUNCTION fn_block_closed_plan_activities() RETURNS TRIGGER AS $$
DECLARE
  plan_status VARCHAR(20);
BEGIN
  SELECT status INTO plan_status
  FROM evaluation_plans
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.evaluation_plan_id ELSE NEW.evaluation_plan_id END;

  -- Si el plan ya no existe (borrado en cascada de una sección o del plan), se permite.
  IF plan_status = 'closed' THEN
    RAISE EXCEPTION 'El plan de evaluación está cerrado: reábrelo para modificar sus actividades.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_closed_plan_activities
  BEFORE INSERT OR UPDATE OR DELETE ON evaluation_activities
  FOR EACH ROW EXECUTE FUNCTION fn_block_closed_plan_activities();
