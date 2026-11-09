-- =====================================================================
-- 090 · Materias pendientes (arrastres) y sus planes especiales
--
-- Un alumno promovido con materias reprobadas cursa su año nuevo con normalidad
-- y, en paralelo, recupera cada materia pendiente con un profesor asignado.
--
--   subject_carryovers  la pendencia: alumno, materia, de qué matrícula viene
--                       (boleta congelada), en qué matrícula sigue y quién la evalúa.
--     status   pending      abierta, sin plan todavía
--              in_progress  con plan: hay un momento abierto
--              passed       aprobó un momento: la materia queda liberada
--              failed       reprobó todos los momentos del plan
--              suspended    alumno retirado (vuelve al reactivarlo)
--              cancelled    anulada por la dirección, con motivo
--
--   carryover_moments   los momentos del plan especial, en cualquier cantidad e
--                       independientes de los períodos del colegio.
--     status   locked       aún no le toca
--              open         el que se puede calificar (uno solo a la vez)
--              passed / failed  calificado
--              not_needed   el alumno aprobó antes de llegar a este momento
--
-- La boleta congelada del año reprobado no se toca: es el histórico de lo que
-- ocurrió ese año; la nota de recuperación vive aquí.
-- La lógica está en carryovers/carryover.service.js.
-- =====================================================================

CREATE TABLE IF NOT EXISTS subject_carryovers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id           UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source_enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  enrollment_id        UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  subject_key          VARCHAR(140) NOT NULL,
  subject_id           UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name         VARCHAR(100) NOT NULL,
  source_final_grade   NUMERIC(5,2),
  passing_grade        NUMERIC(5,2) NOT NULL,   -- la nota mínima del año en que la reprobó
  teacher_id           UUID REFERENCES staff(id) ON DELETE SET NULL,
  status               VARCHAR(12) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'passed', 'failed', 'suspended', 'cancelled')),
  final_grade          NUMERIC(5,2),
  resolved_at          TIMESTAMPTZ,
  cancel_reason        VARCHAR(300),
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_enrollment_id, subject_key)
);
CREATE INDEX IF NOT EXISTS idx_subject_carryovers_student ON subject_carryovers (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS idx_subject_carryovers_teacher ON subject_carryovers (tenant_id, teacher_id);

CREATE TABLE IF NOT EXISTS carryover_moments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  carryover_id  UUID NOT NULL REFERENCES subject_carryovers(id) ON DELETE CASCADE,
  position      INT NOT NULL CHECK (position >= 1),
  name          VARCHAR(80) NOT NULL CHECK (length(trim(name)) > 0),
  description   VARCHAR(500),
  scheduled_on  DATE,
  status        VARCHAR(12) NOT NULL DEFAULT 'locked'
                CHECK (status IN ('locked', 'open', 'passed', 'failed', 'not_needed')),
  grade         NUMERIC(5,2) CHECK (grade IS NULL OR grade >= 0),
  notes         VARCHAR(500),
  graded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  graded_at     TIMESTAMPTZ,
  -- Correcciones: [{ grade, notes, by, at }] con lo que había antes de cada una.
  grade_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (carryover_id, position),
  CHECK ((status IN ('passed', 'failed')) = (grade IS NOT NULL))
);
-- Un solo momento abierto por materia pendiente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_carryover_moments_open ON carryover_moments (carryover_id) WHERE status = 'open';

ALTER TABLE subject_carryovers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subject_carryovers;
CREATE POLICY tenant_isolation ON subject_carryovers USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE carryover_moments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON carryover_moments;
CREATE POLICY tenant_isolation ON carryover_moments USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
