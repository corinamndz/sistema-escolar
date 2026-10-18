-- =====================================================================
-- 042 · Citas con padres
--
--   citas_padres     reunión agendada por la administración o la directiva
--                    con un representante para tratar un tema puntual
--                    (rendimiento, conducta…) de uno de sus representados.
--     guardian_id    representante citado
--     student_id     alumno del que se trata (debe ser representado suyo; opcional)
--     meeting_date   día de la cita
--     start_time     hora de inicio · end_time hora de fin (opcional)
--     location       lugar (opcional): "Dirección", "Aula 3"…
--     topic          motivo o tema a tratar
--     notes          detalle / acuerdos (opcional)
--     status         pending | confirmed | completed | cancelled
--     notify_bell    avisar por la campana del portal
--     notify_email   avisar por correo
--     last_notified_at  último aviso enviado
--
-- Las citas se ven en el calendario de eventos de la administración y los
-- docentes (sin copiarse a school_events: son privadas de cada familia) y,
-- en el portal, solo en la cartelera del representante citado.
--
-- Permisos: módulo "appointments". Roles administrativos (los que editan
-- alumnos): gestión completa. Docente: consulta (solo las citas de los
-- alumnos de su carga).
-- =====================================================================

CREATE TABLE citas_padres (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guardian_id      UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
  meeting_date     DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME,
  location         VARCHAR(150),
  topic            VARCHAR(200) NOT NULL CHECK (length(trim(topic)) > 0),
  notes            VARCHAR(2000),
  status           VARCHAR(12) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  notify_bell      BOOLEAN NOT NULL DEFAULT true,
  notify_email     BOOLEAN NOT NULL DEFAULT false,
  last_notified_at TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_citas_padres_time CHECK (end_time IS NULL OR end_time > start_time)
);
CREATE INDEX idx_citas_padres_date ON citas_padres (tenant_id, meeting_date);
CREATE INDEX idx_citas_padres_guardian ON citas_padres (guardian_id);
CREATE INDEX idx_citas_padres_student ON citas_padres (student_id) WHERE student_id IS NOT NULL;

ALTER TABLE citas_padres ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON citas_padres USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- Módulo y permisos
-- ---------------------------------------------------------------------
INSERT INTO modules (code, label, sort_order) VALUES ('appointments', 'Citas con padres', 15) ON CONFLICT (code) DO NOTHING;

-- Los roles administrativos (los que editan alumnos) gestionan las citas.
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'appointments'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'appointments'));

-- Docentes: consulta (el servicio la limita a los alumnos de su carga).
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'appointments'), false, true, false, false, '{}'::jsonb
FROM roles r
WHERE r.name = 'Docente'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'appointments'));
