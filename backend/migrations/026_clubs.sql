-- =====================================================================
-- 026 · Clubes y actividades extracurriculares
--
--   clubs              catálogo del colegio (Coro escolar, Banda, Ajedrez…)
--     name             nombre (único por colegio, sin distinguir mayúsculas)
--     category         música | deporte | arte | ciencia | idiomas | otro
--     is_custom        true si se creó con la opción "OTRO" (nombre libre,
--                      escrito por quien inscribía, fuera del catálogo sugerido)
--     coordinator_id   docente o personal responsable (opcional)
--     schedule_text    cuándo se reúne, texto libre ("Martes y jueves 2:00 pm")
--     capacity         cupo por año escolar (NULL = sin límite)
--     is_active        los inactivos no reciben inscripciones nuevas
--
--   club_memberships   alumno inscrito en un club en un año escolar
--     status           active | withdrawn (retirado; se conserva el historial)
--     joined_on        fecha de inscripción
--
-- Permisos: módulo "clubs". Administración: gestión completa; Docente: solo
-- consulta (además, el coordinador de un club puede inscribir/retirar en SU
-- club, lo valida el servicio). El representante ve los clubes de sus hijos
-- en el portal (sin permiso de módulo: se filtra por su cuenta).
-- =====================================================================

CREATE TABLE clubs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL CHECK (length(trim(name)) > 0),
  category        VARCHAR(20) NOT NULL DEFAULT 'otro'
                  CHECK (category IN ('musica', 'deporte', 'arte', 'ciencia', 'idiomas', 'otro')),
  description     VARCHAR(500),
  is_custom       BOOLEAN NOT NULL DEFAULT false,
  coordinator_id  UUID REFERENCES staff(id) ON DELETE SET NULL,
  schedule_text   VARCHAR(120),
  capacity        INT CHECK (capacity IS NULL OR capacity > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_clubs_name ON clubs (tenant_id, lower(trim(name)));

CREATE TABLE club_memberships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id           UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  status            VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  joined_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  withdrawn_on      DATE,
  notes             VARCHAR(200),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, student_id, school_period_id)
);
CREATE INDEX idx_club_memberships_student ON club_memberships (tenant_id, student_id, school_period_id);
CREATE INDEX idx_club_memberships_club ON club_memberships (tenant_id, club_id, school_period_id);

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clubs USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON club_memberships USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Módulo "Clubes": gestión completa para quien podía editar alumnos
-- (Administrador); el rol Docente, solo lectura.
INSERT INTO modules (code, label, sort_order) VALUES ('clubs', 'Clubes', 13) ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'clubs'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'clubs'));

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'clubs'), false, true, false, false, '{}'::jsonb
FROM roles r
WHERE r.name = 'Docente'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'clubs'));
