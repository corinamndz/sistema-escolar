-- =====================================================================
-- 020 · Convivencia: sanciones disciplinarias de los alumnos
--
--   student_sanctions   una falta registrada a un alumno:
--     student_id        alumno sancionado
--     school_period_id  año escolar (school_year) en que ocurrió
--     term_id           lapso (opcional)
--     section_id        sección en la que cursaba al momento (referencia; si la
--                       sección se elimina queda en NULL)
--     severity          gravedad: leve | grave | gravisima
--     fault_type        tipo / descripción breve de la falta ("Inasistencia
--                       injustificada", "Agresión verbal"…)
--     description       motivo o detalle
--     measure           medida aplicada (opcional: amonestación, citación…)
--     occurred_on       fecha en que ocurrió
--     registered_by     usuario que la registró (auditoría)
--
-- Permisos: módulo "discipline" (Convivencia). La administración la gestiona;
-- el rol Docente solo consulta, y únicamente de los alumnos de su carga docente
-- (lo filtra el backend con el mismo alcance que el resto de los datos del alumno).
-- =====================================================================

CREATE TABLE student_sanctions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE RESTRICT,
  term_id           UUID REFERENCES terms(id) ON DELETE SET NULL,
  section_id        UUID REFERENCES sections(id) ON DELETE SET NULL,
  severity          VARCHAR(10) NOT NULL CHECK (severity IN ('leve', 'grave', 'gravisima')),
  fault_type        VARCHAR(120) NOT NULL,
  description       TEXT NOT NULL CHECK (length(trim(description)) > 0),
  measure           VARCHAR(200),
  occurred_on       DATE NOT NULL,
  registered_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_sanctions_student ON student_sanctions(tenant_id, student_id, occurred_on DESC);
CREATE INDEX idx_student_sanctions_period ON student_sanctions(tenant_id, school_period_id, occurred_on DESC);

-- El lapso, si se indica, debe ser del mismo año escolar.
CREATE OR REPLACE FUNCTION fn_check_sanction_term() RETURNS trigger AS $$
BEGIN
  IF NEW.term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM terms t WHERE t.id = NEW.term_id AND t.school_period_id = NEW.school_period_id
  ) THEN
    RAISE EXCEPTION 'El lapso no pertenece al año escolar de la sanción.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_sanction_term
  BEFORE INSERT OR UPDATE OF term_id, school_period_id ON student_sanctions
  FOR EACH ROW EXECUTE FUNCTION fn_check_sanction_term();

ALTER TABLE student_sanctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON student_sanctions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Módulo "Convivencia": gestión completa para quien podía editar alumnos
-- (Administrador); el rol Docente, solo lectura.
INSERT INTO modules (code, label, sort_order) VALUES ('discipline', 'Convivencia', 12) ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'discipline'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'discipline'));

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'discipline'), false, true, false, false, '{}'::jsonb
FROM roles r
WHERE r.name = 'Docente'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'discipline'));
