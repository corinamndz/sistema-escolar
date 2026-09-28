-- =====================================================================
-- 002 — Niveles educativos, materias y asignación docente
--
-- Modelo:
--   education_levels            catálogo global (Inicial / Primaria / Secundaria)
--     └─ grades.level_code      todo grado pertenece a un nivel (obligatorio)
--   subjects                    catálogo de materias por colegio
--   grade_subjects              plan de estudios: materias de cada grado (solo secundaria)
--   teacher_sections            docente titular / auxiliar por sección (inicial y primaria)
--   teacher_subject_sections    profesor por materia en cada sección (secundaria)
--
-- Un mismo docente puede aparecer en cualquier cantidad de filas de
-- teacher_sections y teacher_subject_sections: eso es lo que permite que un
-- profesor dé varias materias, en varios grados y secciones.
--
-- Reglas por nivel (se leen de education_levels, no están "hardcodeadas"):
--   initial    homeroom, con auxiliar  → 1 titular + 1 auxiliar por sección
--   primary    homeroom, sin auxiliar  → 1 titular por sección
--   secondary  subjects                → 1 profesor por materia por sección
-- Se aplican en el servicio (mensajes claros al usuario) y se refuerzan aquí
-- con constraints y triggers como red de seguridad.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo de niveles educativos (global, sin tenant_id, como `modules`)
-- ---------------------------------------------------------------------

CREATE TABLE education_levels (
  code              VARCHAR(20) PRIMARY KEY,
  name              VARCHAR(60) NOT NULL,
  sort_order        INT NOT NULL,
  assignment_mode   VARCHAR(20) NOT NULL CHECK (assignment_mode IN ('homeroom', 'subjects')),
  allows_assistant  BOOLEAN NOT NULL DEFAULT false,
  -- El docente auxiliar solo tiene sentido en el modo "docente de aula".
  CHECK (assignment_mode = 'homeroom' OR allows_assistant = false)
);

INSERT INTO education_levels (code, name, sort_order, assignment_mode, allows_assistant) VALUES
  ('initial',   'Educación Inicial',    1, 'homeroom', true),
  ('primary',   'Educación Primaria',   2, 'homeroom', false),
  ('secondary', 'Educación Secundaria', 3, 'subjects', false);

-- ---------------------------------------------------------------------
-- 2. Nivel obligatorio en grados
-- ---------------------------------------------------------------------

ALTER TABLE grades
  ADD COLUMN level_code VARCHAR(20) REFERENCES education_levels(code) ON UPDATE CASCADE;

-- Grados existentes: si alguna de sus secciones ya tenía docente auxiliar,
-- solo pueden ser de Inicial; el resto se asume Primaria. El coordinador
-- puede reclasificarlos luego desde la pestaña Grados.
UPDATE grades g
SET level_code = CASE
  WHEN EXISTS (
    SELECT 1 FROM sections s WHERE s.grade_id = g.id AND s.assistant_teacher_id IS NOT NULL
  ) THEN 'initial'
  ELSE 'primary'
END;

ALTER TABLE grades ALTER COLUMN level_code SET NOT NULL;

CREATE INDEX idx_grades_tenant_level ON grades(tenant_id, level_code, sort_order);

-- ---------------------------------------------------------------------
-- 3. Materias / asignaturas
-- ---------------------------------------------------------------------

CREATE TABLE subjects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  code         VARCHAR(20),              -- abreviatura opcional: "MAT", "CAS"
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Matemática" y "matemática" son la misma materia.
CREATE UNIQUE INDEX ux_subjects_tenant_name ON subjects(tenant_id, lower(name));
CREATE UNIQUE INDEX ux_subjects_tenant_code ON subjects(tenant_id, lower(code)) WHERE code IS NOT NULL;

-- Plan de estudios: qué materias se dictan en cada grado.
CREATE TABLE grade_subjects (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grade_id      UUID NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  weekly_hours  SMALLINT CHECK (weekly_hours IS NULL OR weekly_hours > 0),
  sort_order    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (grade_id, subject_id)
);

CREATE INDEX idx_grade_subjects_subject ON grade_subjects(subject_id);

-- ---------------------------------------------------------------------
-- 4. Asignación docente
-- ---------------------------------------------------------------------

-- Permite la FK compuesta (section_id, grade_id) de teacher_subject_sections.
ALTER TABLE sections ADD CONSTRAINT uq_sections_id_grade UNIQUE (id, grade_id);

-- Inicial y Primaria: docente(s) de aula.
CREATE TABLE teacher_sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  role         VARCHAR(20) NOT NULL CHECK (role IN ('lead', 'assistant')),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (section_id, role),       -- un solo titular y un solo auxiliar por sección
  UNIQUE (section_id, staff_id)    -- el titular no puede ser también el auxiliar
);

CREATE INDEX idx_teacher_sections_staff ON teacher_sections(staff_id);
CREATE INDEX idx_teacher_sections_tenant ON teacher_sections(tenant_id, section_id);

-- Secundaria: un profesor por materia y sección. Las dos FK compuestas
-- garantizan a nivel de base de datos que la materia pertenezca al plan de
-- estudios del grado de ESA sección (no se puede asignar "Química" en una
-- sección cuyo grado no la tiene).
CREATE TABLE teacher_subject_sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id   UUID NOT NULL,
  grade_id     UUID NOT NULL,
  subject_id   UUID NOT NULL,
  staff_id     UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (section_id, grade_id) REFERENCES sections(id, grade_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (grade_id, subject_id) REFERENCES grade_subjects(grade_id, subject_id) ON DELETE CASCADE,
  UNIQUE (section_id, subject_id)  -- una materia tiene un solo profesor en cada sección
);

CREATE INDEX idx_teacher_subject_sections_staff ON teacher_subject_sections(staff_id);
CREATE INDEX idx_teacher_subject_sections_tenant ON teacher_subject_sections(tenant_id, section_id);

-- ---------------------------------------------------------------------
-- 5. Migración de datos: sections.lead/assistant_teacher_id → teacher_sections
--    (antes de crear los triggers de validación, para no rechazar datos
--    históricos que se hayan cargado sin las reglas nuevas)
-- ---------------------------------------------------------------------

INSERT INTO teacher_sections (tenant_id, section_id, staff_id, role)
SELECT tenant_id, id, lead_teacher_id, 'lead'
FROM sections
WHERE lead_teacher_id IS NOT NULL;

INSERT INTO teacher_sections (tenant_id, section_id, staff_id, role)
SELECT tenant_id, id, assistant_teacher_id, 'assistant'
FROM sections
WHERE assistant_teacher_id IS NOT NULL
  AND assistant_teacher_id IS DISTINCT FROM lead_teacher_id;

ALTER TABLE sections DROP COLUMN lead_teacher_id;
ALTER TABLE sections DROP COLUMN assistant_teacher_id;

-- ---------------------------------------------------------------------
-- 6. Planes de evaluación: materia del catálogo
--    `subject` (texto) se conserva como nombre visible: en Inicial/Primaria
--    sigue siendo libre (áreas de aprendizaje); en Secundaria el servicio
--    exige `subject_id` y copia el nombre desde el catálogo.
-- ---------------------------------------------------------------------

ALTER TABLE evaluation_plans
  ADD COLUMN subject_id UUID REFERENCES subjects(id) ON DELETE RESTRICT;

CREATE INDEX idx_evaluation_plans_subject ON evaluation_plans(subject_id);

-- ---------------------------------------------------------------------
-- 7. Triggers de integridad (red de seguridad bajo el servicio)
-- ---------------------------------------------------------------------

-- El asignado debe ser personal DOCENTE, del mismo colegio que la fila.
CREATE OR REPLACE FUNCTION fn_check_assignment_staff() RETURNS TRIGGER AS $$
DECLARE
  s_type    VARCHAR(20);
  s_tenant  UUID;
BEGIN
  SELECT staff_type, tenant_id INTO s_type, s_tenant FROM staff WHERE id = NEW.staff_id;
  IF s_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'El docente no pertenece a este colegio.' USING ERRCODE = 'check_violation';
  END IF;
  IF s_type <> 'teaching' THEN
    RAISE EXCEPTION 'Solo el personal docente puede recibir asignaciones académicas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- teacher_sections: solo en niveles "homeroom"; auxiliar solo si el nivel lo permite.
CREATE OR REPLACE FUNCTION fn_check_teacher_section_level() RETURNS TRIGGER AS $$
DECLARE
  lvl education_levels%ROWTYPE;
BEGIN
  SELECT el.* INTO lvl
  FROM sections s
  JOIN grades g ON g.id = s.grade_id
  JOIN education_levels el ON el.code = g.level_code
  WHERE s.id = NEW.section_id;

  IF lvl.assignment_mode <> 'homeroom' THEN
    RAISE EXCEPTION 'En % los docentes se asignan por materia, no por sección.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.role = 'assistant' AND NOT lvl.allows_assistant THEN
    RAISE EXCEPTION 'En % cada sección tiene un único docente titular (sin auxiliar).', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- grade_subjects: el plan de estudios por materias solo existe en niveles "subjects".
CREATE OR REPLACE FUNCTION fn_check_grade_subject_level() RETURNS TRIGGER AS $$
DECLARE
  lvl education_levels%ROWTYPE;
BEGIN
  SELECT el.* INTO lvl
  FROM grades g JOIN education_levels el ON el.code = g.level_code
  WHERE g.id = NEW.grade_id;

  IF lvl.assignment_mode <> 'subjects' THEN
    RAISE EXCEPTION 'Los grados de % no se organizan por materias.', lvl.name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- grades: no permitir cambiar de nivel si deja asignaciones incompatibles.
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

  IF lvl.assignment_mode = 'homeroom' AND EXISTS (SELECT 1 FROM grade_subjects WHERE grade_id = NEW.id) THEN
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

CREATE TRIGGER trg_teacher_sections_staff
  BEFORE INSERT OR UPDATE OF staff_id, tenant_id ON teacher_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_assignment_staff();

CREATE TRIGGER trg_teacher_sections_level
  BEFORE INSERT OR UPDATE OF section_id, role ON teacher_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_teacher_section_level();

CREATE TRIGGER trg_teacher_subject_sections_staff
  BEFORE INSERT OR UPDATE OF staff_id, tenant_id ON teacher_subject_sections
  FOR EACH ROW EXECUTE FUNCTION fn_check_assignment_staff();

CREATE TRIGGER trg_grade_subjects_level
  BEFORE INSERT OR UPDATE OF grade_id ON grade_subjects
  FOR EACH ROW EXECUTE FUNCTION fn_check_grade_subject_level();

CREATE TRIGGER trg_grades_level_change
  BEFORE UPDATE OF level_code ON grades
  FOR EACH ROW EXECUTE FUNCTION fn_check_grade_level_change();

-- ---------------------------------------------------------------------
-- 8. Row Level Security para las tablas nuevas con tenant_id
--    (education_levels es un catálogo global, igual que `modules`)
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['subjects', 'grade_subjects', 'teacher_sections', 'teacher_subject_sections'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid);',
      t
    );
  END LOOP;
END $$;
