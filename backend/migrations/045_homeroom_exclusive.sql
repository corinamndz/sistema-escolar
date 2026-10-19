-- =====================================================================
-- 045 · Docentes de aula exclusivos por año escolar (Inicial y Primaria)
--
-- Regla: un docente, titular o auxiliar, atiende UNA sola sección de
-- Inicial o Primaria (teacher_sections) por año escolar. En años distintos
-- sí puede (p. ej. el año en curso y el próximo, mientras se arma).
--
-- La valida el servicio (assignment.service: assertHomeroomFree) con un
-- mensaje claro; este trigger es la red de seguridad para cualquier otra
-- escritura. Solo revisa asignaciones NUEVAS o cambiadas: los datos
-- anteriores a la regla no se tocan.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_homeroom_exclusive() RETURNS TRIGGER AS $$
DECLARE
  other record;
BEGIN
  SELECT g.name AS grade_name, s2.name AS section_name
    INTO other
  FROM teacher_sections ts
  JOIN sections s2 ON s2.id = ts.section_id
  JOIN grades g ON g.id = s2.grade_id
  JOIN sections s1 ON s1.id = NEW.section_id
  WHERE ts.staff_id = NEW.staff_id
    AND ts.id <> NEW.id
    AND ts.section_id <> NEW.section_id
    AND s2.school_period_id = s1.school_period_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'El docente ya atiende % sección %: en Inicial y Primaria cada docente atiende una sola sección por año escolar.',
      other.grade_name, other.section_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_teacher_sections_exclusive
  BEFORE INSERT OR UPDATE OF staff_id, section_id ON teacher_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_homeroom_exclusive();
