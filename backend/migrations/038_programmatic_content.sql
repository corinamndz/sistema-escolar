-- =====================================================================
-- 038 · Contenido programático por materia y actividades de evaluación por contenido
--
-- programmatic_content: el temario de una materia EN UN GRADO (Matemática de
-- 1er año no tiene el mismo temario que la de 4to). Cada ítem: Unidad, Tema y
-- Descripción del contenido (los tres obligatorios). Vale para todos los años
-- escolares, igual que el plan de estudios (grade_subjects).
--
-- Vínculo con la evaluación: cada ACTIVIDAD de un plan de evaluación puede
-- indicar el contenido que evalúa (evaluation_activities.programmatic_content_id).
-- Un contenido puede tener varias actividades (un taller y un examen del mismo
-- tema), en uno o varios planes (secciones y lapsos). El vínculo va en la
-- actividad y no en el plan porque el plan es el contenedor de una sección y un
-- lapso cuyas actividades suman 100% y dan la nota del lapso: un plan por tema
-- rompería las notas por lapso, la promoción y las boletas.
--
-- Cascadas:
--   - quitar la materia del grado (o borrar el grado o la materia) borra su
--     contenido programático (FK a grade_subjects ON DELETE CASCADE);
--   - borrar un contenido NO borra sus actividades (pueden tener notas): quedan
--     en su plan, sin contenido (ON DELETE SET NULL).
-- =====================================================================

CREATE TABLE programmatic_content (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grade_id     UUID NOT NULL,
  subject_id   UUID NOT NULL,
  unit         VARCHAR(100) NOT NULL CHECK (length(btrim(unit)) > 0),
  topic        VARCHAR(200) NOT NULL CHECK (length(btrim(topic)) > 0),
  description  TEXT NOT NULL CHECK (length(btrim(description)) > 0 AND length(description) <= 4000),
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La materia debe dictarse en ese grado.
  FOREIGN KEY (grade_id, subject_id) REFERENCES grade_subjects(grade_id, subject_id) ON DELETE CASCADE
);

CREATE INDEX idx_programmatic_content_grade_subject ON programmatic_content(tenant_id, grade_id, subject_id, sort_order);

ALTER TABLE programmatic_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON programmatic_content
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE evaluation_activities
  ADD COLUMN programmatic_content_id UUID REFERENCES programmatic_content(id) ON DELETE SET NULL;

CREATE INDEX idx_evaluation_activities_content ON evaluation_activities(programmatic_content_id) WHERE programmatic_content_id IS NOT NULL;

-- Red de seguridad: el contenido de una actividad es de la misma materia y del
-- mismo grado que su plan de evaluación.
CREATE OR REPLACE FUNCTION fn_check_activity_content() RETURNS trigger AS $$
DECLARE
  plan_subject UUID;
  plan_grade   UUID;
  c            programmatic_content%ROWTYPE;
BEGIN
  IF NEW.programmatic_content_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT ep.subject_id, s.grade_id INTO plan_subject, plan_grade
  FROM evaluation_plans ep JOIN sections s ON s.id = ep.section_id
  WHERE ep.id = NEW.evaluation_plan_id;
  SELECT * INTO c FROM programmatic_content WHERE id = NEW.programmatic_content_id;
  IF c.subject_id IS DISTINCT FROM plan_subject OR c.grade_id IS DISTINCT FROM plan_grade THEN
    RAISE EXCEPTION 'El contenido programático no corresponde a la materia y el grado del plan de evaluación.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evaluation_activities_content
  BEFORE INSERT OR UPDATE OF programmatic_content_id, evaluation_plan_id ON evaluation_activities
  FOR EACH ROW EXECUTE FUNCTION fn_check_activity_content();
