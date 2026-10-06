-- =====================================================================
-- 019 · Profesor guía (tutor) de las secciones de Secundaria
--
-- Opcional. Identifica al docente responsable de la tutoría del grupo. Como
-- cada sección pertenece a un único año escolar, la relación queda ligada a
-- ese año (el año siguiente la sección es otra y tiene su propio guía).
-- Solo aplica a niveles que asignan profesores por materia (Secundaria): lo
-- valida el servicio (assignment.service) y este trigger.
-- =====================================================================

ALTER TABLE sections
  ADD COLUMN guide_teacher_id UUID REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX idx_sections_guide_teacher ON sections(guide_teacher_id) WHERE guide_teacher_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_check_section_guide_teacher() RETURNS trigger AS $$
DECLARE
  mode TEXT;
BEGIN
  IF NEW.guide_teacher_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT el.assignment_mode INTO mode
  FROM grades g JOIN education_levels el ON el.code = g.level_code
  WHERE g.id = NEW.grade_id;
  IF mode IS DISTINCT FROM 'subjects' THEN
    RAISE EXCEPTION 'El profesor guía solo aplica a secciones de Secundaria.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff WHERE id = NEW.guide_teacher_id AND staff_type = 'teaching') THEN
    RAISE EXCEPTION 'El profesor guía debe ser personal docente.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_section_guide_teacher
  BEFORE INSERT OR UPDATE OF guide_teacher_id, grade_id ON sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_section_guide_teacher();
