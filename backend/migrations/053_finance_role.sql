-- =====================================================================
-- 053 · Rol Finanzas
--
-- Rol del personal administrativo de cobranza: acceso EXCLUSIVO al módulo
-- de Pagos (pagos, mensualidades, monedas y tasas). Ningún otro módulo, ni
-- siquiera el panel de inicio: al entrar va directo a Pagos.
--
-- Pagos no depende de otros módulos: los años escolares y los alumnos que
-- necesitan sus formularios se piden a /payments/options/* (permiso payments).
--
-- Fuera de la jerarquía (hierarchy_level NULL): solo el Director lo asigna.
-- Si el colegio ya tiene un rol propio llamado "Finanzas", no se toca.
-- =====================================================================

INSERT INTO roles (tenant_id, name, is_system, hierarchy_level)
SELECT t.id, 'Finanzas', true, NULL
FROM tenants t
WHERE t.id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND lower(r.name) = 'finanzas');

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, m.id, true, true, true, true, '{"approve_payment": true, "export": true}'::jsonb
FROM roles r
JOIN modules m ON m.code = 'payments'
WHERE r.name = 'Finanzas'
  AND r.is_system
  AND r.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id);
