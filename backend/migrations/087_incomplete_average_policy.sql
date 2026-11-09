-- =====================================================================
-- 087 · Qué hacer con el promedio anual si faltan períodos
--
-- La cantidad de períodos es libre (migración 086), así que el divisor del
-- promedio sale siempre de los períodos reales del año. Esta regla de la
-- normativa de cada año decide qué pasa mientras falta alguno:
--
--   evaluated_terms    promedio PROVISIONAL de los períodos con nota; un período
--                      sin evaluar no cuenta como 0 (lo que ya hacía el sistema)
--   all_terms_closed   no hay promedio hasta que todos los períodos tengan nota
--                      y estén cerrados
--
-- El cálculo está en grading/gradeAverages.js.
-- =====================================================================

ALTER TABLE school_periods
  ADD COLUMN IF NOT EXISTS incomplete_average_policy VARCHAR(20) NOT NULL DEFAULT 'evaluated_terms';

ALTER TABLE school_periods DROP CONSTRAINT IF EXISTS ck_school_periods_incomplete_average_policy;
ALTER TABLE school_periods
  ADD CONSTRAINT ck_school_periods_incomplete_average_policy
  CHECK (incomplete_average_policy IN ('evaluated_terms', 'all_terms_closed'));
