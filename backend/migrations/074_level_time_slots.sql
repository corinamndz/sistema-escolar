-- =====================================================================
-- 074 — Jornada (bloques y recreos) por nivel educativo
--
-- Antes (018) todas las secciones del año compartían los mismos bloques y el
-- anti-cruce del docente era un UNIQUE (docente, día, bloque). Ahora cada
-- nivel puede tener su propia jornada:
--
--   time_slots.level_code   NULL  = jornada GENERAL del año (la usan los niveles
--                                   sin jornada propia; los bloques existentes
--                                   quedan aquí: nada cambia hasta configurar).
--                           código = jornada propia de ese nivel (Inicial,
--                                   Primaria, Secundaria), con sus bloques y
--                                   todos los recreos que necesite.
--   Una sección usa la jornada de su nivel si existe; si no, la general.
--
-- Como dos jornadas pueden tener horas distintas (07:00–07:40 en Primaria y
-- 07:00–07:45 en Secundaria), "misma hora" ya no es "mismo bloque": el
-- anti-cruce del docente pasa a comparar HORAS reales:
--   - fn_check_class_schedule_slot: bloque del año (y, si es de un nivel, del de la sección),
--     no recreo, y el docente sin otra clase ese día que se SOLAPE en el tiempo
--     (con un bloqueo por docente y día para que dos guardados simultáneos no
--     se crucen);
--   - trg_time_slots_teacher_overlap: si se cambian las horas de un bloque con
--     clases, no puede quedar un docente con dos clases solapadas (diferible:
--     se verifica al terminar de guardar toda la jornada).
-- Dentro de una jornada los bloques y recreos no se solapan (lo valida el
-- servicio al guardarla): una clase nunca cae en el recreo de su nivel.
-- =====================================================================

ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS level_code VARCHAR(20) REFERENCES education_levels(code);
ALTER TABLE time_slots ADD COLUMN IF NOT EXISTS level_key VARCHAR(20) GENERATED ALWAYS AS (COALESCE(level_code, '*')) STORED;

-- Hora de inicio única por jornada (antes: por año). Diferible para reordenar.
ALTER TABLE time_slots DROP CONSTRAINT IF EXISTS uq_time_slots_start;
ALTER TABLE time_slots ADD CONSTRAINT uq_time_slots_start UNIQUE (school_period_id, level_key, start_time) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS idx_time_slots_level ON time_slots(tenant_id, school_period_id, level_key, start_time);

-- ¿El nivel tiene jornada propia en el año?
CREATE OR REPLACE FUNCTION fn_level_has_own_slots(p_period UUID, p_level VARCHAR) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM time_slots WHERE school_period_id = p_period AND level_code = p_level);
$$ LANGUAGE sql STABLE;

-- Validación de cada clase (reemplaza la de 018).
CREATE OR REPLACE FUNCTION fn_check_class_schedule_slot() RETURNS trigger AS $$
DECLARE
  slot RECORD;
  sec RECORD;
  clash RECORD;
BEGIN
  SELECT school_period_id, is_break, level_code, start_time, end_time, name INTO slot FROM time_slots WHERE id = NEW.time_slot_id;
  SELECT s.school_period_id, g.level_code INTO sec FROM sections s JOIN grades g ON g.id = s.grade_id WHERE s.id = NEW.section_id;
  IF slot.school_period_id IS DISTINCT FROM sec.school_period_id THEN
    RAISE EXCEPTION 'El bloque horario no pertenece al año escolar de la sección.' USING ERRCODE = '23514';
  END IF;
  IF slot.level_code IS NOT NULL AND slot.level_code IS DISTINCT FROM sec.level_code THEN
    RAISE EXCEPTION 'El bloque horario es de la jornada de otro nivel.' USING ERRCODE = '23514';
  END IF;
  -- (Que una sección de un nivel con jornada propia no use la general lo decide
  -- schedule.service: al crear o quitar esa jornada, sus clases se reubican y,
  -- mientras tanto, conviven bloques de ambas.)
  IF slot.is_break THEN
    RAISE EXCEPTION 'No se pueden programar clases en un recreo.' USING ERRCODE = '23514';
  END IF;

  -- Anti-cruce por horas: un bloqueo por docente y día serializa los guardados simultáneos.
  PERFORM pg_advisory_xact_lock(hashtext('class_schedules:' || NEW.staff_id::text || ':' || NEW.day_of_week::text));
  SELECT ts.start_time, ts.end_time INTO clash
  FROM class_schedules cs JOIN time_slots ts ON ts.id = cs.time_slot_id
  WHERE cs.staff_id = NEW.staff_id AND cs.day_of_week = NEW.day_of_week AND cs.id IS DISTINCT FROM NEW.id
    AND ts.start_time < slot.end_time AND slot.start_time < ts.end_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'El docente ya tiene otra clase que se solapa con ese horario (%–%).', to_char(clash.start_time, 'HH24:MI'), to_char(clash.end_time, 'HH24:MI')
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_class_schedule_slot ON class_schedules;
CREATE TRIGGER trg_check_class_schedule_slot
  BEFORE INSERT OR UPDATE OF time_slot_id, section_id, staff_id, day_of_week ON class_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_check_class_schedule_slot();

-- Cambiar las horas de un bloque con clases no puede dejar a un docente con dos clases solapadas.
CREATE OR REPLACE FUNCTION fn_time_slots_teacher_overlap() RETURNS trigger AS $$
DECLARE
  bad RECORD;
BEGIN
  SELECT a.staff_id, a.day_of_week INTO bad
  FROM class_schedules a
  JOIN time_slots ta ON ta.id = a.time_slot_id
  JOIN class_schedules b ON b.staff_id = a.staff_id AND b.day_of_week = a.day_of_week AND b.id <> a.id
  JOIN time_slots tb ON tb.id = b.time_slot_id
  WHERE a.time_slot_id = NEW.id
    AND ta.start_time < tb.end_time AND tb.start_time < ta.end_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Con las nuevas horas de «%», un docente quedaría con dos clases solapadas el mismo día.', NEW.name USING ERRCODE = '23P01';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_time_slots_teacher_overlap ON time_slots;
CREATE CONSTRAINT TRIGGER trg_time_slots_teacher_overlap
  AFTER UPDATE OF start_time, end_time ON time_slots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_time_slots_teacher_overlap();
