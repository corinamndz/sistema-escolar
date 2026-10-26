-- =====================================================================
-- 058 · Revisión y aprobación: Planes de evaluación y Contenido programático
--
-- Flujo entre el Docente y el Coordinador (de SU nivel) o el Director:
--   borrador ──enviar──▶ en_revision ──aprobar──▶ aprobado
--      ▲                     │
--      │                     └─devolver con observaciones─▶ observado ──reenviar──▶ en_revision
--      └── cualquier cambio a algo en_revision o aprobado lo devuelve a borrador
--          (trigger), para que nada aprobado cambie sin una nueva revisión.
--
--   evaluation_plans.review_status   estado del plan (cada plan es un registro).
--     (status 'open'/'closed' es otra cosa: el cierre de la carga de notas.)
--   programmatic_content_reviews     estado del PROGRAMA de una materia en un
--     grado (grade_id + subject_id): el contenido programático son muchas filas
--     (unidad/tema) y se revisa completo, no tema por tema.
--   review_comments                  hilo de comentarios de cada plan o programa,
--     con los cambios de estado registrados como entradas del hilo.
-- Corre en public y en cada esquema de colegio.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Planes de evaluación
-- ---------------------------------------------------------------------
ALTER TABLE evaluation_plans
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(12) NOT NULL DEFAULT 'borrador',
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_evaluation_plans_review_status' AND conrelid = 'evaluation_plans'::regclass) THEN
    ALTER TABLE evaluation_plans ADD CONSTRAINT ck_evaluation_plans_review_status
      CHECK (review_status IN ('borrador', 'en_revision', 'observado', 'aprobado'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_evaluation_plans_review ON evaluation_plans (tenant_id, review_status) WHERE review_status = 'en_revision';

-- ---------------------------------------------------------------------
-- 2. Programa (contenido programático) de una materia en un grado
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programmatic_content_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grade_id      UUID NOT NULL,
  subject_id    UUID NOT NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'borrador'
                CHECK (status IN ('borrador', 'en_revision', 'observado', 'aprobado')),
  submitted_at  TIMESTAMPTZ,
  submitted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, grade_id, subject_id),
  FOREIGN KEY (grade_id, subject_id) REFERENCES grade_subjects(grade_id, subject_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_reviews_pending ON programmatic_content_reviews (tenant_id, status) WHERE status = 'en_revision';

-- ---------------------------------------------------------------------
-- 3. Hilo de comentarios (de un plan O de un programa)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id            UUID REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  content_review_id  UUID REFERENCES programmatic_content_reviews(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name        VARCHAR(150),              -- como se llamaba al comentar
  author_role        VARCHAR(20),               -- docente | coordinacion | direccion | sistema
  kind               VARCHAR(12) NOT NULL DEFAULT 'comment'
                     CHECK (kind IN ('comment', 'submitted', 'observed', 'approved', 'reset')),
  body               TEXT CHECK (body IS NULL OR length(body) <= 4000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK ((plan_id IS NULL) <> (content_review_id IS NULL)),
  CHECK (kind <> 'comment' OR (body IS NOT NULL AND length(btrim(body)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_review_comments_plan ON review_comments (plan_id, created_at) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_comments_content ON review_comments (content_review_id, created_at) WHERE content_review_id IS NOT NULL;

ALTER TABLE programmatic_content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_comments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'programmatic_content_reviews' AND policyname = 'tenant_isolation' AND schemaname = current_schema()) THEN
    CREATE POLICY tenant_isolation ON programmatic_content_reviews USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'review_comments' AND policyname = 'tenant_isolation' AND schemaname = current_schema()) THEN
    CREATE POLICY tenant_isolation ON review_comments USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Cambiar algo en revisión o aprobado lo devuelve a borrador
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_review_reset_plan(p_plan_id UUID) RETURNS void AS $$
DECLARE
  previous VARCHAR(12);
  tenant UUID;
BEGIN
  IF p_plan_id IS NULL THEN RETURN; END IF;
  SELECT review_status, tenant_id INTO previous, tenant FROM evaluation_plans WHERE id = p_plan_id FOR UPDATE;
  IF previous IN ('en_revision', 'aprobado') THEN
    UPDATE evaluation_plans SET review_status = 'borrador' WHERE id = p_plan_id;
    INSERT INTO review_comments (tenant_id, plan_id, author_role, kind, body)
    VALUES (tenant, p_plan_id, 'sistema', 'reset',
            CASE previous WHEN 'aprobado' THEN 'El plan se modificó después de aprobado: vuelve a borrador y necesita una nueva revisión.'
                          ELSE 'El plan se modificó mientras estaba en revisión: vuelve a borrador; reenvíalo cuando termines.' END);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_review_reset_plan_child() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'evaluation_plan_sections' THEN
    PERFORM fn_review_reset_plan(COALESCE(NEW.plan_id, OLD.plan_id));
  ELSE
    PERFORM fn_review_reset_plan(COALESCE(NEW.evaluation_plan_id, OLD.evaluation_plan_id));
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_reset_activities ON evaluation_activities;
CREATE TRIGGER trg_review_reset_activities AFTER INSERT OR UPDATE OR DELETE ON evaluation_activities
  FOR EACH ROW EXECUTE FUNCTION fn_review_reset_plan_child();
DROP TRIGGER IF EXISTS trg_review_reset_plan_sections ON evaluation_plan_sections;
CREATE TRIGGER trg_review_reset_plan_sections AFTER INSERT OR DELETE ON evaluation_plan_sections
  FOR EACH ROW EXECUTE FUNCTION fn_review_reset_plan_child();
DROP TRIGGER IF EXISTS trg_review_reset_projects ON pedagogical_projects;
CREATE TRIGGER trg_review_reset_projects AFTER INSERT OR UPDATE OR DELETE ON pedagogical_projects
  FOR EACH ROW EXECUTE FUNCTION fn_review_reset_plan_child();

CREATE OR REPLACE FUNCTION fn_review_reset_content() RETURNS trigger AS $$
DECLARE
  r programmatic_content_reviews%ROWTYPE;
  g UUID := COALESCE(NEW.grade_id, OLD.grade_id);
  s UUID := COALESCE(NEW.subject_id, OLD.subject_id);
BEGIN
  SELECT * INTO r FROM programmatic_content_reviews WHERE grade_id = g AND subject_id = s FOR UPDATE;
  IF FOUND AND r.status IN ('en_revision', 'aprobado') THEN
    UPDATE programmatic_content_reviews SET status = 'borrador' WHERE id = r.id;
    INSERT INTO review_comments (tenant_id, content_review_id, author_role, kind, body)
    VALUES (r.tenant_id, r.id, 'sistema', 'reset',
            CASE r.status WHEN 'aprobado' THEN 'El contenido se modificó después de aprobado: vuelve a borrador y necesita una nueva revisión.'
                          ELSE 'El contenido se modificó mientras estaba en revisión: vuelve a borrador; reenvíalo cuando termines.' END);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_reset_content ON programmatic_content;
CREATE TRIGGER trg_review_reset_content AFTER INSERT OR UPDATE OR DELETE ON programmatic_content
  FOR EACH ROW EXECUTE FUNCTION fn_review_reset_content();
