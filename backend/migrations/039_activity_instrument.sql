-- =====================================================================
-- 039 · Instrumento de evaluación de la actividad (formato detallado)
--
-- El formato detallado (migración 012) ya guarda la estrategia, el puntaje,
-- los criterios con sus indicadores y puntos, y las fechas por sección. Falta
-- el INSTRUMENTO con que se evalúa: rúbrica, escala de estimación, lista de
-- cotejo… Es opcional (las actividades existentes quedan sin instrumento).
-- Los criterios e indicadores con su puntaje son el desglose del instrumento.
-- =====================================================================

ALTER TABLE evaluation_activities
  ADD COLUMN instrument VARCHAR(30)
    CHECK (instrument IS NULL OR instrument IN ('rubric', 'estimation_scale', 'checklist', 'written_test', 'observation_record', 'other'));
