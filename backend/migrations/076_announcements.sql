-- =====================================================================
-- 076 — Comunicados (avisos que redacta la administración)
--
-- Un comunicado es una notificación más (031): se guarda UNA vez, con los
-- destinatarios ya resueltos en target_user_ids (audience 'users', 059) y el
-- trigger de 061 toma la foto en notification_recipients para auditar quién
-- lo leyó. Aparece en la campana y en el Centro de notificaciones de cada
-- destinatario como cualquier aviso.
--
--   notifications.body_html   texto con formato, YA SANEADO en el servidor
--                             (lista blanca: párrafos, negritas, cursivas,
--                             listas, enlaces y alineación). `body` guarda el
--                             mismo texto plano (resumen para la campana).
--   notifications.category    academic | administrative | urgent | event
--   notifications.created_by  quién lo envió
--
-- Permiso: módulo «Comunicados» (announcements). Lo reciben los roles que hoy
-- pueden editar la Configuración del colegio (el Administrador).
-- =====================================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notifications_category;
ALTER TABLE notifications ADD CONSTRAINT ck_notifications_category
  CHECK (category IS NULL OR category IN ('academic', 'administrative', 'urgent', 'event'));

CREATE INDEX IF NOT EXISTS idx_notifications_announcements ON notifications (tenant_id, created_at DESC) WHERE type = 'announcement';

INSERT INTO modules (code, label, sort_order) VALUES ('announcements', 'Comunicados', 30) ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'announcements'), true, true, false, false, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'tenant_settings'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update
  AND r.name NOT IN ('Docente', 'Representante')
  AND rp.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'announcements'));
