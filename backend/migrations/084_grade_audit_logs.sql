-- =====================================================================
-- 084 · Ajuste directivo de calificaciones definitivas
--
-- El Administrador o el Coordinador del nivel pueden cambiar la DEFINITIVA de
-- una materia en un lapso (p. ej. tras una jornada de revisión de notas), con
-- un motivo obligatorio. Cada ajuste es un registro de este historial:
--
--   grade_audit_logs   un renglón por ajuste (solo se agregan: no se editan)
--     student_id, school_period_id, term_id      alumno, año y lapso
--     subject_id / subject_name                  materia (id del plan de estudios o,
--                                                en Inicial, el área en texto libre)
--     computed_grade   lo que calculó el sistema con las actividades en ese momento
--     previous_grade   la nota vigente antes del ajuste (calculada o un ajuste anterior)
--     new_grade        la nota nueva; NULL = se quitó el ajuste (vuelve a la calculada)
--     reason           motivo (obligatorio, mínimo 10 caracteres)
--     adjusted_by / adjusted_by_name / adjusted_by_role   quién (admin | coordinacion) y cuándo
--
-- La nota vigente de un (alumno, año, lapso, materia) es la del ÚLTIMO renglón:
-- si su new_grade es NULL, rige la calculada. Se aplica en el resumen, la
-- boleta, el expediente / promoción y el portal del representante
-- (grading/gradeAdjustments.service.js).
-- =====================================================================

CREATE TABLE IF NOT EXISTS grade_audit_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id         UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_period_id   UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  term_id            UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  enrollment_id      UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  subject_id         UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name       VARCHAR(150) NOT NULL,
  computed_grade     NUMERIC(5, 2),
  previous_grade     NUMERIC(5, 2),
  new_grade          NUMERIC(5, 2) CHECK (new_grade IS NULL OR (new_grade >= 0 AND new_grade <= 20)),
  reason             VARCHAR(500) NOT NULL CHECK (char_length(btrim(reason)) >= 10),
  adjusted_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  adjusted_by_name   VARCHAR(150),
  adjusted_by_role   VARCHAR(20) NOT NULL CHECK (adjusted_by_role IN ('admin', 'coordinacion')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grade_audit_student ON grade_audit_logs (tenant_id, student_id, school_period_id, created_at);

-- Historial inalterable: no se editan los ajustes (sí se borran en cascada con el alumno, el año o el lapso).
CREATE OR REPLACE FUNCTION fn_grade_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de ajustes de calificaciones no se puede modificar.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_grade_audit_immutable ON grade_audit_logs;
CREATE TRIGGER trg_grade_audit_immutable BEFORE UPDATE ON grade_audit_logs FOR EACH ROW EXECUTE FUNCTION fn_grade_audit_immutable();

ALTER TABLE grade_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grade_audit_logs;
CREATE POLICY tenant_isolation ON grade_audit_logs USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
