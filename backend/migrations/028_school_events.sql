-- =====================================================================
-- 028 · Cartelera de eventos especiales del colegio
--
-- NOTA: esta es la versión original (varias fechas por evento) y NO debe
-- modificarse: ya está aplicada en bases existentes. La 029 la convierte a
-- una sola fecha por evento.
--
--   school_events        actos culturales, eventos familiares, asambleas
--                        de padres, reuniones, jornadas deportivas…
--     title              título del evento
--     category           cultural | familiar | asamblea | deportivo |
--                        institucional | otro
--     description        detalle (programa, qué traer, vestimenta…)
--     location           lugar (opcional): "Patio central", "Aula 3"…
--     audience           a quién va dirigido:
--                          school   todo el colegio
--                          grade    un año/grado (grade_id) — sus secciones
--                          section  una sección en particular (section_id)
--     is_published       los borradores (false) no se ven en el portal
--     created_by         usuario que lo creó
--
--   school_event_dates   cada fecha del evento con su horario (opcional)
--     event_date         el día (única por evento)
--     start_time         hora de inicio (NULL = todo el día)
--     end_time           hora de fin (opcional, posterior al inicio)
--
-- Un evento tiene una o varias fechas (selector múltiple), cada una con su
-- propia hora: p. ej. una asamblea el 20/10 a las 7:00 y su segunda
-- convocatoria el 27/10 a las 17:00.
--
-- Al borrar el grado o la sección de destino se borra el evento (ya no
-- tendría a quién ir dirigido); al borrar el evento, sus fechas.
--
-- Permisos: módulo "events". Administración: gestión completa; Docente:
-- consulta. El representante ve la cartelera en el portal (sin permiso de
-- módulo: se filtra por los grados y secciones de sus representados).
-- =====================================================================

CREATE TABLE school_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         VARCHAR(150) NOT NULL CHECK (length(trim(title)) > 0),
  category      VARCHAR(20) NOT NULL DEFAULT 'institucional'
                CHECK (category IN ('cultural', 'familiar', 'asamblea', 'deportivo', 'institucional', 'otro')),
  description   VARCHAR(4000),
  location      VARCHAR(150),
  audience      VARCHAR(10) NOT NULL DEFAULT 'school' CHECK (audience IN ('school', 'grade', 'section')),
  grade_id      UUID REFERENCES grades(id) ON DELETE CASCADE,
  section_id    UUID REFERENCES sections(id) ON DELETE CASCADE,
  is_published  BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_school_events_audience CHECK (
    (audience = 'school'  AND grade_id IS NULL     AND section_id IS NULL) OR
    (audience = 'grade'   AND grade_id IS NOT NULL AND section_id IS NULL) OR
    (audience = 'section' AND section_id IS NOT NULL AND grade_id IS NULL)
  )
);
CREATE INDEX idx_school_events_tenant ON school_events (tenant_id, audience);

CREATE TABLE school_event_dates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES school_events(id) ON DELETE CASCADE,
  event_date  DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  UNIQUE (event_id, event_date),
  CONSTRAINT ck_school_event_dates_time CHECK (end_time IS NULL OR (start_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX idx_school_event_dates_date ON school_event_dates (tenant_id, event_date);

ALTER TABLE school_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_events USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE school_event_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON school_event_dates USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------
-- Módulo y permisos
-- ---------------------------------------------------------------------
INSERT INTO modules (code, label, sort_order) VALUES ('events', 'Eventos y cartelera', 14) ON CONFLICT (code) DO NOTHING;

-- Los roles administrativos (los que editan alumnos) gestionan la cartelera.
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'events'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante')
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'events'));

-- Docentes: consulta.
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'events'), false, true, false, false, '{}'::jsonb
FROM roles r
WHERE r.name = 'Docente'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'events'));
