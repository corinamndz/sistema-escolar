-- =====================================================================
-- 078 — Planillas de inscripción personalizables (form builder)
--
-- enrollment_forms        la planilla que diseña el colegio para un año escolar:
--   fields  JSONB         lista ordenada de campos:
--                         [{ id, type, label, help?, required?, placeholder?, options?: [..] }]
--                         type: section | short_text | long_text | number | date | email |
--                               phone | select | radio | checkboxes | checkbox
--   status                draft (en diseño) | published (las familias la ven) | closed
--
-- enrollment_form_submissions   la planilla completada por un representante
--   student_id     el alumno (re-inscripción) o NULL si es un aspirante nuevo
--   applicant_name nombre del aspirante nuevo (cuando no hay student_id)
--   answers        JSONB { <id del campo>: valor }
--   fields_snapshot  copia de los campos al enviar: si luego se edita la
--                    planilla, la respuesta se sigue leyendo con su versión
--   status         submitted (en revisión) | changes_requested (corregir) | approved | rejected
--
-- Un alumno tiene a lo sumo UNA planilla por formulario (índice parcial).
-- Permiso: módulo «Planillas de inscripción» (enrollment_forms) para los roles
-- que editan Alumnos.
-- =====================================================================

CREATE TABLE IF NOT EXISTS enrollment_forms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  title             VARCHAR(150) NOT NULL,
  description       VARCHAR(1000),
  fields            JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  status            VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  published_at      TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enrollment_forms_period ON enrollment_forms (tenant_id, school_period_id);

CREATE TABLE IF NOT EXISTS enrollment_form_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id          UUID NOT NULL REFERENCES enrollment_forms(id) ON DELETE CASCADE,
  guardian_id      UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
  applicant_name   VARCHAR(150),
  answers          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  fields_snapshot  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'changes_requested', 'approved', 'rejected')),
  review_note      VARCHAR(500),
  reviewed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_enrollment_submission_who CHECK (student_id IS NOT NULL OR applicant_name IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollment_submission_student ON enrollment_form_submissions (form_id, student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollment_submissions_form ON enrollment_form_submissions (tenant_id, form_id, status);
CREATE INDEX IF NOT EXISTS idx_enrollment_submissions_guardian ON enrollment_form_submissions (guardian_id);

ALTER TABLE enrollment_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enrollment_forms;
CREATE POLICY tenant_isolation ON enrollment_forms USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
DROP POLICY IF EXISTS tenant_isolation ON enrollment_form_submissions;
CREATE POLICY tenant_isolation ON enrollment_form_submissions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Módulo y permisos: los roles administrativos que editan Alumnos.
INSERT INTO modules (code, label, sort_order) VALUES ('enrollment_forms', 'Planillas de inscripción', 17) ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'enrollment_forms'), true, true, true, true, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante', 'Coordinador')
  AND rp.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'enrollment_forms'));
