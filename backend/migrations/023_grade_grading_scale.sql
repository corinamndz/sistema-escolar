-- =====================================================================
-- 023 · Escala de calificación por grado
--
--   grades.grading_scale
--     quantitative  numérica (0 a 20): las notas se cargan y se muestran
--                   como números, con sus promedios (por defecto).
--     qualitative   literal / descriptiva (A, B, C, D, E): las notas se
--                   cargan eligiendo un literal y se muestran como literal
--                   con su concepto (A · Excelente…).
--
-- Los CÁLCULOS no cambian: internamente toda nota sigue siendo un número
-- sobre la escala de 20 (cada literal guarda el valor representativo de su
-- rango), así promedios de lapso, promoción e historial funcionan igual en
-- los dos tipos de grado. Las equivalencias literal ↔ rango viven en el
-- código (backend/src/modules/grading/gradingScale.js y su par del frontend).
-- =====================================================================

ALTER TABLE grades
  ADD COLUMN grading_scale VARCHAR(12) NOT NULL DEFAULT 'quantitative'
    CHECK (grading_scale IN ('quantitative', 'qualitative'));

COMMENT ON COLUMN grades.grading_scale IS 'Escala de calificación del grado: quantitative (0-20) | qualitative (literales A-E)';
