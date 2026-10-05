-- =====================================================================
-- 015 · Lapso académico numerado (Lapso I, II, III)
--
-- Un plan de evaluación ya pertenece a un lapso (evaluation_plans.term_id) y
-- sus actividades heredan ese lapso. Lo que faltaba era un número FIJO de
-- lapso: los lapsos se creaban a mano con nombre libre y, si un año no tenía
-- lapsos, no se podía crear ningún plan.
--
--   terms.term_number   1, 2 o 3 (único por año escolar)
--
-- Además se garantiza que todo año escolar tenga sus 3 lapsos.
-- =====================================================================

ALTER TABLE terms
  ADD COLUMN term_number SMALLINT CHECK (term_number BETWEEN 1 AND 3);

CREATE UNIQUE INDEX uq_terms_period_number ON terms (school_period_id, term_number) WHERE term_number IS NOT NULL;

-- Lapsos existentes:
--   1. El número sale del nombre: "Lapso 2", "2do lapso", "Segundo lapso", "Lapso II".
--      Solo si ese número no se repite en el mismo año.
--   2. Los que queden sin número toman los números libres en orden de fecha de inicio.
DO $$
DECLARE
  r RECORD;
  free_n SMALLINT;
BEGIN
  WITH guessed AS (
    SELECT id, school_period_id,
           CASE
             WHEN name ~ '(^|\D)1(\D|$)' OR name ~* '(primer|1er|\mI\M)' THEN 1
             WHEN name ~ '(^|\D)2(\D|$)' OR name ~* '(segundo|2do|\mII\M)' THEN 2
             WHEN name ~ '(^|\D)3(\D|$)' OR name ~* '(tercer|3er|\mIII\M)' THEN 3
           END AS n
    FROM terms
  ), unique_guess AS (
    SELECT id, n FROM guessed g
    WHERE n IS NOT NULL
      AND (SELECT count(*) FROM guessed g2 WHERE g2.school_period_id = g.school_period_id AND g2.n = g.n) = 1
  )
  UPDATE terms t SET term_number = u.n FROM unique_guess u WHERE u.id = t.id;

  FOR r IN SELECT id, school_period_id FROM terms WHERE term_number IS NULL ORDER BY school_period_id, start_date NULLS LAST, name LOOP
    SELECT min(n) INTO free_n
    FROM generate_series(1, 3) AS n
    WHERE NOT EXISTS (SELECT 1 FROM terms t WHERE t.school_period_id = r.school_period_id AND t.term_number = n);
    IF free_n IS NOT NULL THEN
      UPDATE terms SET term_number = free_n WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Años sin alguno de sus 3 lapsos: se crean ("Lapso 1", "Lapso 2", "Lapso 3").
INSERT INTO terms (tenant_id, school_period_id, name, term_number)
SELECT sp.tenant_id, sp.id, 'Lapso ' || n, n
FROM school_periods sp
CROSS JOIN generate_series(1, 3) AS n
WHERE NOT EXISTS (SELECT 1 FROM terms t WHERE t.school_period_id = sp.id AND t.term_number = n)
ON CONFLICT (tenant_id, school_period_id, name) DO NOTHING;
