-- =====================================================================
-- 081 — Aprobación directa de planes de evaluación y contenido programático
--
-- El Administrador o el Coordinador del nivel pueden aprobar un plan o un
-- programa SIN que el docente lo envíe a revisión (desde borrador, con
-- observaciones o en revisión → aprobado). Trazabilidad:
--   * approval_mode   cómo quedó aprobado: 'review' (flujo normal) | 'direct'
--                     (aprobación directa). NULL mientras no está aprobado.
--   * reviewed_at / reviewed_by   cuándo y quién aprobó (ya existían, 058).
--   * review_comments.kind = 'direct_approved'   el evento en el hilo, con su
--                     fecha, autor, rol (Dirección / Coordinación) y el estado
--                     del que venía.
-- =====================================================================

ALTER TABLE evaluation_plans ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(8);
ALTER TABLE programmatic_content_reviews ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(8);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_evaluation_plans_approval_mode' AND conrelid = 'evaluation_plans'::regclass) THEN
    ALTER TABLE evaluation_plans ADD CONSTRAINT ck_evaluation_plans_approval_mode
      CHECK (approval_mode IS NULL OR approval_mode IN ('review', 'direct'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_content_reviews_approval_mode' AND conrelid = 'programmatic_content_reviews'::regclass) THEN
    ALTER TABLE programmatic_content_reviews ADD CONSTRAINT ck_content_reviews_approval_mode
      CHECK (approval_mode IS NULL OR approval_mode IN ('review', 'direct'));
  END IF;
END $$;

-- Lo ya aprobado antes de esta migración pasó por el flujo normal.
UPDATE evaluation_plans SET approval_mode = 'review' WHERE review_status = 'aprobado' AND approval_mode IS NULL;
UPDATE programmatic_content_reviews SET approval_mode = 'review' WHERE status = 'aprobado' AND approval_mode IS NULL;

-- Nuevo tipo de evento en el hilo de revisión.
ALTER TABLE review_comments ALTER COLUMN kind TYPE VARCHAR(20);
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'review_comments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%' AND pg_get_constraintdef(oid) LIKE '%submitted%'
  LOOP
    EXECUTE format('ALTER TABLE review_comments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE review_comments ADD CONSTRAINT ck_review_comments_kind
  CHECK (kind IN ('comment', 'submitted', 'observed', 'approved', 'direct_approved', 'reset'));
