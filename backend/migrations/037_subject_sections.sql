-- =====================================================================
-- 037 · Materias por grado Y por sección
--
-- Hasta ahora una materia se asignaba a GRADOS (grade_subjects) y quedaba
-- disponible en todas sus secciones. El módulo de Materias permite elegir las
-- secciones específicas: "Francés solo en 4to año A".
--
-- Modelo: grade_subjects sigue diciendo en qué grados se dicta la materia
-- (y vale para todos los años escolares). Por defecto la ven TODAS las
-- secciones del grado, incluidas las que se abran el año siguiente; esta tabla
-- guarda las secciones donde NO se dicta. Así:
--   - las secciones nuevas reciben las materias del grado sin pasos extra;
--   - nada existente cambia (ninguna exclusión = igual que antes).
--
-- Cascadas:
--   - borrar la sección o quitar la materia del grado borra sus exclusiones
--     (FK ON DELETE CASCADE);
--   - excluir una sección borra el profesor de esa materia en ella y sus
--     clases del horario (trigger), y se rechaza si ya tiene planes de
--     evaluación (no se dejan planes huérfanos);
--   - no se puede asignar profesor ni poner en el horario una materia
--     excluida de la sección (trigger, red de seguridad bajo el servicio).
-- =====================================================================

CREATE TABLE section_subject_exclusions (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id  UUID NOT NULL,
  grade_id    UUID NOT NULL,
  subject_id  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, subject_id),
  -- La sección debe ser de ese grado, y la materia estar en el plan de ese grado.
  FOREIGN KEY (section_id, grade_id) REFERENCES sections(id, grade_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (grade_id, subject_id) REFERENCES grade_subjects(grade_id, subject_id) ON DELETE CASCADE
);

CREATE INDEX idx_section_subject_exclusions_tenant ON section_subject_exclusions(tenant_id, subject_id);

ALTER TABLE section_subject_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON section_subject_exclusions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Excluir: no si ya hay planes de evaluación de la materia en la sección.
CREATE OR REPLACE FUNCTION fn_check_section_subject_exclusion() RETURNS trigger AS $$
BEGIN
  -- Planes propios de la sección o compartidos con ella (evaluation_plan_sections).
  IF EXISTS (
    SELECT 1 FROM evaluation_plans ep
    WHERE ep.subject_id = NEW.subject_id
      AND (ep.section_id = NEW.section_id
           OR EXISTS (SELECT 1 FROM evaluation_plan_sections ps WHERE ps.plan_id = ep.id AND ps.section_id = NEW.section_id))
  ) THEN
    RAISE EXCEPTION 'La materia ya tiene planes de evaluación en esta sección: no se puede quitar de ella.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_section_subject_exclusions_check
  BEFORE INSERT ON section_subject_exclusions
  FOR EACH ROW EXECUTE FUNCTION fn_check_section_subject_exclusion();

-- Excluir: se va el profesor de esa materia en la sección y sus clases del horario.
CREATE OR REPLACE FUNCTION fn_apply_section_subject_exclusion() RETURNS trigger AS $$
BEGIN
  DELETE FROM teacher_subject_sections WHERE section_id = NEW.section_id AND subject_id = NEW.subject_id;
  DELETE FROM class_schedules WHERE section_id = NEW.section_id AND subject_id = NEW.subject_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_section_subject_exclusions_cascade
  AFTER INSERT ON section_subject_exclusions
  FOR EACH ROW EXECUTE FUNCTION fn_apply_section_subject_exclusion();

-- Profesor u horario de una materia excluida de la sección: rechazado.
CREATE OR REPLACE FUNCTION fn_check_subject_available_in_section() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM section_subject_exclusions WHERE section_id = NEW.section_id AND subject_id = NEW.subject_id) THEN
    RAISE EXCEPTION 'La materia no se dicta en esta sección.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_teacher_subject_sections_available
  BEFORE INSERT OR UPDATE OF section_id, subject_id ON teacher_subject_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_subject_available_in_section();

CREATE TRIGGER trg_class_schedules_available
  BEFORE INSERT OR UPDATE OF section_id, subject_id ON class_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_check_subject_available_in_section();
