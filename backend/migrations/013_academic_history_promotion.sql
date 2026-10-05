-- =====================================================================
-- 013 — Historial académico, cierre de año escolar y promoción de alumnos
--
-- El historial YA existe en el modelo y no se pierde al cambiar de año:
--   enrollments (alumno + sección)  → la sección fija el grado y el año escolar
--   evaluation_plans (por sección y lapso del año) → actividades → activity_scores
-- Un año nuevo tiene secciones y planes nuevos: nada del año anterior se
-- sobrescribe. Lo que faltaba, y agrega esta migración:
--
--   enrollments                 resultado del año: status promoted / retained /
--                               graduated (además de active = cursando y
--                               withdrawn = retirado), fecha de cierre, promedio,
--                               materias reprobadas y enlace a la inscripción
--                               del año siguiente.
--   enrollment_subject_results  "boleta" congelada al cerrar: nota de cada lapso
--                               y nota final por materia. Editar después un plan
--                               del año cerrado no cambia el resultado histórico.
--   school_periods              closed_at: el año queda "Finalizado".
-- =====================================================================

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
    CHECK (status IN ('active', 'withdrawn', 'promoted', 'retained', 'graduated')),
  ADD COLUMN closed_at           TIMESTAMPTZ,
  ADD COLUMN closed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN final_average       NUMERIC(5,2),
  ADD COLUMN failed_subjects     INT CHECK (failed_subjects IS NULL OR failed_subjects >= 0),
  ADD COLUMN outcome_notes       VARCHAR(300),
  ADD COLUMN next_enrollment_id  UUID REFERENCES enrollments(id) ON DELETE SET NULL;

-- Un resultado de cierre (promovido/repite/egresado) siempre tiene fecha.
ALTER TABLE enrollments
  ADD CONSTRAINT ck_enrollments_closed_outcome
    CHECK (status NOT IN ('promoted', 'retained', 'graduated') OR closed_at IS NOT NULL);

-- Un alumno no puede estar CURSANDO dos secciones del mismo año escolar.
CREATE OR REPLACE FUNCTION fn_check_single_active_enrollment() RETURNS TRIGGER AS $$
DECLARE
  period_id UUID;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  SELECT school_period_id INTO period_id FROM sections WHERE id = NEW.section_id;
  IF EXISTS (
    SELECT 1 FROM enrollments e JOIN sections s ON s.id = e.section_id
    WHERE e.student_id = NEW.student_id AND e.status = 'active' AND e.id <> NEW.id
      AND s.school_period_id = period_id
  ) THEN
    RAISE EXCEPTION 'El alumno ya está inscrito en otra sección de ese año escolar.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_single_active_enrollment
  BEFORE INSERT OR UPDATE OF status, section_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION fn_check_single_active_enrollment();

CREATE TABLE enrollment_subject_results (
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id  UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  subject_key    VARCHAR(140) NOT NULL,             -- subject_id o nombre del área (Inicial)
  subject_id     UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name   VARCHAR(100) NOT NULL,
  -- [{ "term_id": "…", "term_name": "Primer Lapso", "grade": 15.5, "status": "final" }]
  terms          JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(terms) = 'array'),
  final_grade    NUMERIC(5,2),
  passed         BOOLEAN,
  complete       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, subject_key)
);

ALTER TABLE school_periods
  ADD COLUMN closed_at  TIMESTAMPTZ,
  ADD COLUMN closed_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- Un año finalizado no está activo.
ALTER TABLE school_periods
  ADD CONSTRAINT ck_school_periods_closed_inactive CHECK (closed_at IS NULL OR NOT is_active);

ALTER TABLE enrollment_subject_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enrollment_subject_results
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
