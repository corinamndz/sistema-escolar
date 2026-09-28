-- =====================================================================
-- 009 — Plan de estudios por materias también en Primaria
--
-- Hasta ahora `assignment_mode` decidía DOS cosas a la vez:
--   1. cómo se asignan los docentes (por sección o por materia), y
--   2. si el grado tiene plan de estudios por materias.
-- Por eso Primaria ('homeroom') no podía tener materias y aparecía como
-- "No aplica". Se separan ambos conceptos con `has_curriculum`:
--
--   nivel       assignment_mode  has_curriculum  docentes
--   initial     homeroom         false           titular + auxiliar (áreas libres)
--   primary     homeroom         true            titular de aula que dicta todas las
--                                                materias; opcionalmente un docente
--                                                especialista por materia (Inglés,
--                                                Educación Física…)
--   secondary   subjects         true            un profesor por materia
--
-- Los especialistas de Primaria se guardan en `teacher_subject_sections`, la
-- misma tabla de Secundaria (con sus FK compuestas: la materia debe estar en el
-- plan de estudios del grado de la sección). Nada existente cambia de forma.
-- =====================================================================

ALTER TABLE education_levels ADD COLUMN has_curriculum BOOLEAN NOT NULL DEFAULT false;

UPDATE education_levels SET has_curriculum = true WHERE code IN ('primary', 'secondary');

-- Asignar profesores por materia exige que haya materias.
ALTER TABLE education_levels
  ADD CONSTRAINT ck_education_levels_subjects_need_curriculum CHECK (assignment_mode = 'homeroom' OR has_curriculum);

-- grade_subjects: el plan de estudios existe en los niveles con `has_curriculum`
-- (antes: solo en assignment_mode = 'subjects').
CREATE OR REPLACE FUNCTION fn_check_grade_subject_level() RETURNS TRIGGER AS $$
DECLARE
  lvl education_levels%ROWTYPE;
BEGIN
  SELECT el.* INTO lvl
  FROM grades g JOIN education_levels el ON el.code = g.level_code
  WHERE g.id = NEW.grade_id;

  IF NOT lvl.has_curriculum THEN
    RAISE EXCEPTION 'Los grados de % no se organizan por materias.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- grades: cambio de nivel. Igual que en 002, pero el plan de estudios solo
-- bloquea el paso a un nivel SIN plan de estudios (hoy: Inicial). Pasar de
-- Secundaria a Primaria conserva materias y profesores por materia (quedan
-- como especialistas).
CREATE OR REPLACE FUNCTION fn_check_grade_level_change() RETURNS TRIGGER AS $$
DECLARE
  lvl education_levels%ROWTYPE;
BEGIN
  IF NEW.level_code = OLD.level_code THEN
    RETURN NEW;
  END IF;
  SELECT * INTO lvl FROM education_levels WHERE code = NEW.level_code;

  IF lvl.assignment_mode = 'subjects' AND EXISTS (
    SELECT 1 FROM teacher_sections ts JOIN sections s ON s.id = ts.section_id WHERE s.grade_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'El grado tiene docentes de aula asignados; quítalos antes de pasarlo a %.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT lvl.has_curriculum AND EXISTS (SELECT 1 FROM grade_subjects WHERE grade_id = NEW.id) THEN
    RAISE EXCEPTION 'El grado tiene materias en su plan de estudios; quítalas antes de pasarlo a %.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT lvl.allows_assistant AND EXISTS (
    SELECT 1 FROM teacher_sections ts JOIN sections s ON s.id = ts.section_id
    WHERE s.grade_id = NEW.id AND ts.role = 'assistant'
  ) THEN
    RAISE EXCEPTION 'El grado tiene docentes auxiliares asignados; quítalos antes de pasarlo a %.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
