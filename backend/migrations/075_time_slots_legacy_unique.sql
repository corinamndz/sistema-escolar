-- =====================================================================
-- 075 — Quita el UNIQUE antiguo de time_slots (por año y hora de inicio)
--
-- 018 creó UNIQUE (school_period_id, start_time) con el nombre
-- uq_time_slots_start. En los esquemas de colegio (copiados de public por el
-- Tenant Manager) esa restricción quedó con un nombre automático
-- (time_slots_school_period_id_start_time_key), así que la 074 —que la borró
-- por nombre— no la quitó allí. Como es diferible, solo saltaba al confirmar:
-- una jornada de nivel que empezara a la misma hora que la general (07:00)
-- fallaba en el COMMIT y no se guardaba.
--
-- Se borra por DEFINICIÓN (sea cual sea su nombre): cualquier UNIQUE de
-- time_slots exactamente sobre (school_period_id, start_time). La regla vigente
-- es la de 074: uq_time_slots_start (school_period_id, level_key, start_time).
-- =====================================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    WHERE t.oid = to_regclass('time_slots')
      AND con.contype = 'u'
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k)
          = ARRAY['school_period_id', 'start_time']
  LOOP
    EXECUTE format('ALTER TABLE time_slots DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
