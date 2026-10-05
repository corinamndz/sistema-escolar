-- =====================================================================
-- 016 · Módulo "Cierre y promoción" separado de "academics"
--
-- La promoción se protegía con el permiso de "academics" y el rol Docente
-- tiene "academics" en lectura (para ver grados y secciones), así que podía
-- entrar al cierre de año. Ahora es un módulo propio:
--   - lo reciben, con los mismos permisos, los roles que podían EDITAR la
--     estructura académica (el Administrador), así nadie pierde acceso;
--   - el rol Docente no lo recibe, y se le retira cualquier permiso sobre
--     pagos o promoción que se le hubiera dado.
-- =====================================================================

INSERT INTO modules (code, label, sort_order)
VALUES ('promotion', 'Cierre y promoción', 10)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT rp.tenant_id, rp.role_id, (SELECT id FROM modules WHERE code = 'promotion'),
       rp.can_create, rp.can_read, rp.can_update, rp.can_delete, '{}'::jsonb
FROM role_permissions rp
JOIN modules m ON m.id = rp.module_id AND m.code = 'academics'
JOIN roles r ON r.id = rp.role_id
WHERE rp.can_update AND r.name <> 'Docente'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions x
    WHERE x.role_id = rp.role_id AND x.module_id = (SELECT id FROM modules WHERE code = 'promotion')
  );

DELETE FROM role_permissions rp
USING roles r, modules m
WHERE r.id = rp.role_id AND m.id = rp.module_id
  AND r.name = 'Docente' AND m.code IN ('payments', 'promotion');
