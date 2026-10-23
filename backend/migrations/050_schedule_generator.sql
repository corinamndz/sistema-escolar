-- =====================================================================
-- 050 · Generador automático de horarios
--
-- La matriz del horario ya existe (018): class_schedules = sección + materia
-- + docente + día + bloque (time_slots), con anti-cruce garantizado por la
-- base. Esta migración agrega lo que el generador necesita:
--
--   teacher_unavailability   bloques en que un docente NO puede dar clase
--                            (trabaja en otro colegio, tiene otra función…).
--                            Se guarda lo NO disponible: por defecto, todo
--                            docente está disponible en todos los bloques.
--   schedule_generations     cada corrida del generador: su propuesta (vista
--                            previa), los conflictos encontrados y si se
--                            aplicó. Se aplica exactamente lo que se revisó;
--                            `input_hash` detecta si los datos cambiaron entre
--                            la vista previa y el guardado.
--   class_schedules.generation_id   de qué corrida salió una clase (NULL = a mano).
-- =====================================================================

CREATE TABLE IF NOT EXISTS teacher_unavailability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id      UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  time_slot_id  UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,  -- el bloque define el año escolar
  reason        VARCHAR(120),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, day_of_week, time_slot_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_unavailability_staff ON teacher_unavailability(tenant_id, staff_id);

CREATE TABLE IF NOT EXISTS schedule_generations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  status            VARCHAR(12) NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'applied', 'discarded')),
  mode              VARCHAR(10) NOT NULL CHECK (mode IN ('fill', 'replace')),  -- completar lo que falta | rehacer desde cero
  section_ids       UUID[] NOT NULL,          -- secciones que abarca la corrida
  input_hash        CHAR(40) NOT NULL,        -- huella de los datos de entrada
  result            JSONB NOT NULL,           -- { entries, conflicts, stats }
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_schedule_generations_period ON schedule_generations(tenant_id, school_period_id, created_at DESC);

ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES schedule_generations(id) ON DELETE SET NULL;

ALTER TABLE teacher_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_generations ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'teacher_unavailability' AND policyname = 'tenant_isolation' AND schemaname = current_schema()) THEN
    CREATE POLICY tenant_isolation ON teacher_unavailability USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schedule_generations' AND policyname = 'tenant_isolation' AND schemaname = current_schema()) THEN
    CREATE POLICY tenant_isolation ON schedule_generations USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;
