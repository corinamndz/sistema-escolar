-- =====================================================================
-- 080 — Una matrícula pertenece para siempre a su año escolar
--
-- enrollments → sections → school_periods: el año de una matrícula es el de
-- su sección. Promover NO modifica la matrícula del año que termina (solo la
-- cierra con su resultado: promoted / retained / graduated) y CREA otra en el
-- año nuevo (promotion.service → applyDecision). Esta regla lo garantiza en la
-- base de datos: un UPDATE no puede mover una matrícula a una sección de OTRO
-- año escolar (cambiar de sección dentro del mismo año sí se permite). Así el
-- historial de años anteriores no se puede sobrescribir por error.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_enrollment_keeps_period() RETURNS TRIGGER AS $$
DECLARE
  old_period UUID;
  new_period UUID;
BEGIN
  IF NEW.section_id IS NOT DISTINCT FROM OLD.section_id THEN
    RETURN NEW;
  END IF;
  SELECT school_period_id INTO old_period FROM sections WHERE id = OLD.section_id;
  SELECT school_period_id INTO new_period FROM sections WHERE id = NEW.section_id;
  IF old_period IS DISTINCT FROM new_period THEN
    RAISE EXCEPTION 'Una inscripción no puede pasar a otro año escolar: crea una inscripción nueva en ese año (promoción).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enrollment_keeps_period ON enrollments;
CREATE TRIGGER trg_enrollment_keeps_period
  BEFORE UPDATE OF section_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION fn_enrollment_keeps_period();
