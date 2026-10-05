-- =====================================================================
-- 012 — Planes de evaluación: formato detallado y planes de varias secciones
--
-- Formato (evaluation_plans.format):
--   simple    actividad = título, descripción, tipo, porcentaje (como hasta ahora)
--   detailed  planificador institucional: por actividad (fila del plan)
--               · referencias teórico-prácticas  (content_refs: temas y subtemas)
--               · estrategia evaluativa            (strategy)
--               · criterios → indicadores          (evaluation_criteria / evaluation_indicators)
--               · puntaje por indicador            (los puntos suman max_score de la actividad)
--               · fecha de aplicación por sección  (activity_section_dates)
--
-- Varias secciones: el docente redacta el plan UNA vez (materia + lapso) y lo
-- aplica a las secciones que dicta. `evaluation_plan_sections` lista TODAS las
-- secciones del plan; `evaluation_plans.section_id` queda como la sección
-- principal (siempre incluida). Las notas siguen siendo por alumno, y cada
-- alumno pertenece a una de las secciones del plan.
--
-- Nota por indicador: `indicator_scores` guarda lo obtenido en cada indicador;
-- `activity_scores.raw_score` es su suma (y max_score el de la actividad), así
-- el acumulado del lapso se calcula igual en los dos formatos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Formato del plan
-- ---------------------------------------------------------------------
ALTER TABLE evaluation_plans
  ADD COLUMN format VARCHAR(20) NOT NULL DEFAULT 'simple' CHECK (format IN ('simple', 'detailed'));

-- ---------------------------------------------------------------------
-- 2. Secciones del plan
-- ---------------------------------------------------------------------
CREATE TABLE evaluation_plan_sections (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id     UUID NOT NULL REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  section_id  UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, section_id)
);
CREATE INDEX idx_evaluation_plan_sections_section ON evaluation_plan_sections (section_id);

-- Planes existentes: su única sección.
INSERT INTO evaluation_plan_sections (tenant_id, plan_id, section_id)
SELECT tenant_id, id, section_id FROM evaluation_plans;

-- Red de seguridad: todas las secciones de un plan son del mismo grado y año
-- escolar que la principal, y una sección no puede tener dos planes del mismo
-- lapso, docente y materia.
CREATE OR REPLACE FUNCTION fn_check_plan_section() RETURNS TRIGGER AS $$
DECLARE
  p        evaluation_plans%ROWTYPE;
  main_sec sections%ROWTYPE;
  new_sec  sections%ROWTYPE;
BEGIN
  SELECT * INTO p FROM evaluation_plans WHERE id = NEW.plan_id;
  SELECT * INTO main_sec FROM sections WHERE id = p.section_id;
  SELECT * INTO new_sec FROM sections WHERE id = NEW.section_id;

  IF new_sec.grade_id <> main_sec.grade_id OR new_sec.school_period_id <> main_sec.school_period_id THEN
    RAISE EXCEPTION 'Todas las secciones de un plan deben ser del mismo grado y año escolar.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM evaluation_plan_sections x
    JOIN evaluation_plans o ON o.id = x.plan_id
    WHERE x.section_id = NEW.section_id
      AND o.id <> NEW.plan_id
      AND o.term_id = p.term_id
      AND o.teacher_id = p.teacher_id
      AND lower(o.subject) = lower(p.subject)
  ) THEN
    RAISE EXCEPTION 'La sección % ya tiene un plan de % para ese lapso.', new_sec.name, p.subject
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_plan_section
  BEFORE INSERT OR UPDATE ON evaluation_plan_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_plan_section();

-- ---------------------------------------------------------------------
-- 3. Estructura detallada de las actividades
-- ---------------------------------------------------------------------
ALTER TABLE evaluation_activities
  ADD COLUMN strategy      VARCHAR(200),
  -- [{ "topic": "Números reales", "subtopics": ["Definición", "Propiedades"] }]
  ADD COLUMN content_refs  JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(content_refs) = 'array'),
  -- Puntaje máximo de la actividad (suma de sus indicadores en el formato detallado).
  ADD COLUMN max_score     NUMERIC(5,2) NOT NULL DEFAULT 20 CHECK (max_score > 0 AND max_score <= 100);

CREATE TABLE evaluation_criteria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id  UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  position     INT NOT NULL,
  title        VARCHAR(300) NOT NULL CHECK (length(trim(title)) > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evaluation_criteria_activity ON evaluation_criteria (activity_id, position);

CREATE TABLE evaluation_indicators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  criterion_id  UUID NOT NULL REFERENCES evaluation_criteria(id) ON DELETE CASCADE,
  activity_id   UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  position      INT NOT NULL,
  description   VARCHAR(300) NOT NULL CHECK (length(trim(description)) > 0),
  points        NUMERIC(5,2) NOT NULL CHECK (points > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evaluation_indicators_activity ON evaluation_indicators (activity_id);

CREATE TABLE activity_section_dates (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id  UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  applied_on   DATE NOT NULL,
  PRIMARY KEY (activity_id, section_id)
);

-- Nota obtenida por un alumno en cada indicador. Un indicador calificado no se
-- puede borrar (RESTRICT): el servicio lo explica antes de llegar aquí.
CREATE TABLE indicator_scores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  indicator_id  UUID NOT NULL REFERENCES evaluation_indicators(id) ON DELETE RESTRICT,
  activity_id   UUID NOT NULL REFERENCES evaluation_activities(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  points        NUMERIC(5,2) NOT NULL CHECK (points >= 0),
  graded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (indicator_id, student_id)
);
CREATE INDEX idx_indicator_scores_activity_student ON indicator_scores (activity_id, student_id);

-- Lo obtenido no puede superar el puntaje del indicador.
CREATE OR REPLACE FUNCTION fn_check_indicator_score() RETURNS TRIGGER AS $$
DECLARE
  max_points NUMERIC(5,2);
BEGIN
  SELECT points INTO max_points FROM evaluation_indicators WHERE id = NEW.indicator_id;
  IF NEW.points > max_points THEN
    RAISE EXCEPTION 'La nota del indicador (%) supera su puntaje (%).', NEW.points, max_points
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_indicator_score
  BEFORE INSERT OR UPDATE ON indicator_scores
  FOR EACH ROW EXECUTE FUNCTION fn_check_indicator_score();

-- Plan cerrado: su estructura (criterios, indicadores, fechas) queda bloqueada,
-- igual que las actividades (006). Las notas se siguen cargando.
CREATE OR REPLACE FUNCTION fn_block_closed_plan_structure() RETURNS TRIGGER AS $$
DECLARE
  plan_status VARCHAR(20);
BEGIN
  SELECT ep.status INTO plan_status
  FROM evaluation_activities a JOIN evaluation_plans ep ON ep.id = a.evaluation_plan_id
  WHERE a.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.activity_id ELSE NEW.activity_id END;
  -- Si la actividad ya no existe (borrado en cascada), se permite.
  IF plan_status = 'closed' THEN
    RAISE EXCEPTION 'El plan de evaluación está cerrado: reábrelo para modificar su estructura.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_closed_criteria BEFORE INSERT OR UPDATE OR DELETE ON evaluation_criteria
  FOR EACH ROW EXECUTE FUNCTION fn_block_closed_plan_structure();
CREATE TRIGGER trg_block_closed_indicators BEFORE INSERT OR UPDATE OR DELETE ON evaluation_indicators
  FOR EACH ROW EXECUTE FUNCTION fn_block_closed_plan_structure();
CREATE TRIGGER trg_block_closed_section_dates BEFORE INSERT OR UPDATE OR DELETE ON activity_section_dates
  FOR EACH ROW EXECUTE FUNCTION fn_block_closed_plan_structure();

-- ---------------------------------------------------------------------
-- 4. Row Level Security de las tablas nuevas
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['evaluation_plan_sections', 'evaluation_criteria', 'evaluation_indicators', 'activity_section_dates', 'indicator_scores'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid);',
      t
    );
  END LOOP;
END $$;
