-- =====================================================================
-- 065 · Reconocimientos a estudiantes
--
--   student_recognitions   un logro reconocido por el colegio a un alumno
--     student_id           alumno reconocido                    (alumno_id)
--     awarded_by_staff_id  quien lo otorga, de Personal          (otorgado_por)
--     awarded_by_user_id   el usuario que lo registró (si no está en Personal)
--     category             excellence | effort | conduct | leadership |
--                          solidarity | sports | arts | other    (categoria)
--     title                "Cuadro de honor del 1er lapso"       (titulo)
--     message              el motivo, dirigido a la familia      (mensaje)
--     awarded_on           fecha del reconocimiento              (fecha)
--     notification_id      el aviso que recibió la familia
--
-- Al registrarlo se avisa a los representantes del alumno (aviso
-- "recognition" de la matriz de Configuración → Notificaciones), con un
-- diseño especial en la campana, el Centro de notificaciones y el portal.
--
-- Permisos: módulo "recognitions". Roles administrativos (los que editan
-- alumnos): gestión completa. Docente: registra y consulta los de los alumnos
-- de su carga y edita o elimina solo los que otorgó (lo valida el servicio).
-- =====================================================================

CREATE TABLE IF NOT EXISTS student_recognitions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id           UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  school_period_id     UUID REFERENCES school_periods(id) ON DELETE SET NULL,
  awarded_by_staff_id  UUID REFERENCES staff(id) ON DELETE SET NULL,
  awarded_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  category             VARCHAR(20) NOT NULL
                         CHECK (category IN ('excellence', 'effort', 'conduct', 'leadership', 'solidarity', 'sports', 'arts', 'other')),
  title                VARCHAR(120) NOT NULL CHECK (length(trim(title)) > 0),
  message              VARCHAR(800) NOT NULL CHECK (length(trim(message)) > 0),
  awarded_on           DATE NOT NULL,
  notification_id      UUID REFERENCES notifications(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_student_recognitions_student ON student_recognitions (tenant_id, student_id, awarded_on DESC);
CREATE INDEX IF NOT EXISTS idx_student_recognitions_recent ON student_recognitions (tenant_id, awarded_on DESC);

ALTER TABLE student_recognitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_recognitions;
CREATE POLICY tenant_isolation ON student_recognitions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Módulo y permisos
INSERT INTO modules (code, label, sort_order) VALUES ('recognitions', 'Reconocimientos', 16) ON CONFLICT (code) DO NOTHING;

-- Roles administrativos (los que editan alumnos): gestión completa.
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'recognitions'), true, true, true, true, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'students'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name NOT IN ('Docente', 'Representante', 'Coordinador')
  AND rp.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'recognitions'));

-- Docentes: registran y consultan (el servicio limita a su carga y a lo que otorgaron).
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, (SELECT id FROM modules WHERE code = 'recognitions'), true, true, true, true, '{}'::jsonb
FROM roles r
WHERE r.name = 'Docente'
  AND r.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = (SELECT id FROM modules WHERE code = 'recognitions'));

-- Nuevo aviso de la matriz: recognition ("Reconocimientos").
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notification_preferences'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE notification_preferences DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE notification_preferences
  ADD CONSTRAINT ck_notification_preferences_event_type
  CHECK (event_type IN ('bcv_rate', 'payment_confirmed', 'school_event', 'sanction', 'club_enrollment', 'parent_meeting', 'evaluation_plan', 'evaluation_reminder', 'payment_overdue', 'recognition'));
