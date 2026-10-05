-- =====================================================================
-- 014 · Reglas de evaluación del año escolar (aprobación de materias y promoción)
--
-- Cada año escolar define su normativa:
--   passing_grade        nota mínima aprobatoria de una materia (escala 1–20)
--   max_failed_subjects  materias reprobadas con las que aún se promueve
--                        (materias pendientes / aplazadas)
--   term_average_mode    cómo se promedian los lapsos de una materia:
--                          'arithmetic' → (L1 + L2 + L3) / 3
--                          'weighted'   → Σ (Lx × peso del lapso) / 100
--   grade_rounding       'none'    → se conservan los decimales (12,35)
--                        'integer' → definitiva de lapso y nota final se
--                                    redondean al entero (9,5 → 10)
-- El peso de cada lapso vive en terms.weight_percent (solo modo ponderado).
--
-- Al cerrar una inscripción (promoción) se guarda una copia de las reglas
-- aplicadas en enrollments.evaluation_rules: el historial sigue mostrando con
-- qué normativa se decidió aunque luego se cambien las reglas del año.
-- =====================================================================

ALTER TABLE school_periods
  ADD COLUMN passing_grade       NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (passing_grade > 0 AND passing_grade <= 20),
  ADD COLUMN max_failed_subjects INT NOT NULL DEFAULT 0
    CHECK (max_failed_subjects BETWEEN 0 AND 20),
  ADD COLUMN term_average_mode   VARCHAR(12) NOT NULL DEFAULT 'arithmetic'
    CHECK (term_average_mode IN ('arithmetic', 'weighted')),
  ADD COLUMN grade_rounding      VARCHAR(10) NOT NULL DEFAULT 'none'
    CHECK (grade_rounding IN ('none', 'integer'));

ALTER TABLE terms
  ADD COLUMN weight_percent NUMERIC(5,2)
    CHECK (weight_percent IS NULL OR (weight_percent > 0 AND weight_percent <= 100));

ALTER TABLE enrollments
  ADD COLUMN evaluation_rules JSONB
    CHECK (evaluation_rules IS NULL OR jsonb_typeof(evaluation_rules) = 'object');
