-- =====================================================================
-- 086 · Períodos de evaluación configurables por colegio
--
-- `terms` es la tabla de períodos de evaluación de cada año escolar: planes,
-- sanciones y ajustes ya la referencian por term_id, y las notas a través de
-- actividad → plan. Lo único rígido era el límite de 3 (migración 015).
--
--   term_number   posición del período en el año (1, 2, 3…), sin tope de 3
--   name          nombre libre: "Trimestre 1", "Primer momento", "Semestre 2"…
--
-- El tope (12 por año) y las demás reglas están en
-- academics/evaluationPeriods.service.js.
-- =====================================================================

ALTER TABLE terms DROP CONSTRAINT IF EXISTS terms_term_number_check;
ALTER TABLE terms ADD CONSTRAINT terms_term_number_check CHECK (term_number >= 1);
ALTER TABLE terms ALTER COLUMN name TYPE VARCHAR(60);

-- Períodos antiguos sin posición: van después de los numerados, por fecha y nombre.
WITH ranked AS (
  SELECT t.id,
         (SELECT COALESCE(max(x.term_number), 0) FROM terms x WHERE x.school_period_id = t.school_period_id)
           + row_number() OVER (PARTITION BY t.school_period_id ORDER BY t.start_date NULLS LAST, t.name) AS n
  FROM terms t
  WHERE t.term_number IS NULL
)
UPDATE terms t SET term_number = r.n FROM ranked r WHERE r.id = t.id;
