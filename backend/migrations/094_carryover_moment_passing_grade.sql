-- =====================================================================
-- 094 · Nota mínima por momento del plan especial (materias pendientes)
--
-- Cada momento se aprueba con su propia nota mínima. Nunca es menor que la del
-- año en que se reprobó la materia (subject_carryovers.passing_grade): el
-- profesor puede exigir más en un momento, no menos. Lo valida el servicio
-- (carryovers/carryover.service.js, savePlan).
-- Los momentos que ya existían toman la nota mínima de su materia pendiente.
-- =====================================================================

ALTER TABLE carryover_moments ADD COLUMN IF NOT EXISTS passing_grade NUMERIC(5,2);

UPDATE carryover_moments m
   SET passing_grade = c.passing_grade
  FROM subject_carryovers c
 WHERE c.id = m.carryover_id AND m.passing_grade IS NULL;

ALTER TABLE carryover_moments ALTER COLUMN passing_grade SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carryover_moments_passing_grade_range' AND conrelid = 'carryover_moments'::regclass) THEN
    ALTER TABLE carryover_moments ADD CONSTRAINT carryover_moments_passing_grade_range CHECK (passing_grade >= 0 AND passing_grade <= 20);
  END IF;
END $$;
