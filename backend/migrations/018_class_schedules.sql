-- =====================================================================
-- 018 · Horarios de clase por sección
--
--   time_slots       bloques horarios de un año escolar (Bloque 1: 07:00–07:45,
--                    Recreo…). Todas las secciones del año comparten los mismos
--                    bloques: así "misma hora" = mismo bloque y el cruce de un
--                    docente se puede garantizar en la base de datos.
--   class_schedules  una clase: sección (+ grado), materia, docente, día y bloque.
--                    El docente se toma de la carga docente al colocar la clase.
--
-- Reglas garantizadas por la base:
--   - una sola clase por celda de una sección (sección + día + bloque);
--   - un docente no puede tener dos clases en el mismo día y bloque
--     (anti-cruce entre secciones y grados);
--   - la materia pertenece al plan de estudios del grado de la sección;
--   - el bloque es del mismo año escolar que la sección y no es un recreo.
-- =====================================================================

CREATE TABLE time_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  name              VARCHAR(40) NOT NULL,          -- "Bloque 1", "Recreo"
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  is_break          BOOLEAN NOT NULL DEFAULT false, -- recreo / almuerzo: no admite clases
  sort_order        INT NOT NULL DEFAULT 0,
  CHECK (end_time > start_time),
  -- Diferible: al reordenar los bloques del año se actualizan varios a la vez.
  CONSTRAINT uq_time_slots_start UNIQUE (school_period_id, start_time) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_time_slots_period ON time_slots(tenant_id, school_period_id, start_time);
-- (Que dos bloques del mismo año no se solapen lo valida schedule.service al guardarlos.)

CREATE TABLE class_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section_id    UUID NOT NULL,
  grade_id      UUID NOT NULL,
  subject_id    UUID NOT NULL,
  staff_id      UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,   -- docente (teacher_id)
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5), -- 1 = lunes … 5 = viernes
  time_slot_id  UUID NOT NULL REFERENCES time_slots(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (section_id, grade_id) REFERENCES sections(id, grade_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (grade_id, subject_id) REFERENCES grade_subjects(grade_id, subject_id) ON DELETE CASCADE,
  UNIQUE (section_id, day_of_week, time_slot_id),   -- una clase por celda
  UNIQUE (staff_id, day_of_week, time_slot_id)      -- anti-cruce del docente
);
CREATE INDEX idx_class_schedules_section ON class_schedules(tenant_id, section_id);
CREATE INDEX idx_class_schedules_staff ON class_schedules(tenant_id, staff_id);

-- El bloque debe ser del año escolar de la sección y no ser un recreo.
CREATE OR REPLACE FUNCTION fn_check_class_schedule_slot() RETURNS trigger AS $$
DECLARE
  slot RECORD;
  section_period UUID;
BEGIN
  SELECT school_period_id, is_break INTO slot FROM time_slots WHERE id = NEW.time_slot_id;
  SELECT school_period_id INTO section_period FROM sections WHERE id = NEW.section_id;
  IF slot.school_period_id IS DISTINCT FROM section_period THEN
    RAISE EXCEPTION 'El bloque horario no pertenece al año escolar de la sección.' USING ERRCODE = '23514';
  END IF;
  IF slot.is_break THEN
    RAISE EXCEPTION 'No se pueden programar clases en un recreo.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_class_schedule_slot
  BEFORE INSERT OR UPDATE OF time_slot_id, section_id ON class_schedules
  FOR EACH ROW EXECUTE FUNCTION fn_check_class_schedule_slot();

-- RLS por colegio, como el resto de las tablas de negocio.
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON time_slots USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON class_schedules USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Módulo "Horarios": lo reciben, con los mismos permisos, los roles que podían
-- EDITAR la estructura académica (el Administrador). Docentes y representantes
-- consultan sus horarios por rutas propias, de solo lectura.
INSERT INTO modules (code, label, sort_order) VALUES ('schedules', 'Horarios', 11) ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'schedules'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'academics'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'schedules'));
