-- =====================================================================
-- 057 · Rol Coordinador: solo sus módulos, con alcance por nivel
--
-- El coordinador trabaja SOLO en:
--   Inicio (dashboard)             consulta (sus cifras, de su nivel)
--   Personal (staff)               gestión de los docentes de su nivel
--   Planes de evaluación y         gestión (el módulo evaluation_plans cubre
--   Contenido programático         ambos), solo secciones de su nivel
--   Horarios (schedules)           gestión, solo secciones y docentes de su nivel
-- Se le quitan los demás (alumnos, representantes, académico, calificaciones,
-- convivencia, clubes, eventos, citas…). El alcance por nivel lo aplica el
-- backend (access/coordinatorScope.js); estos son los permisos de módulo.
-- Corre en public y en cada esquema de colegio.
-- =====================================================================

-- 1) Fuera todo lo que no es de sus módulos.
DELETE FROM role_permissions rp
USING roles r, modules m
WHERE r.id = rp.role_id AND m.id = rp.module_id
  AND r.name = 'Coordinador' AND r.is_system
  AND m.code NOT IN ('dashboard', 'staff', 'evaluation_plans', 'schedules');

-- 2) Sus módulos, con estos permisos (se actualizan si ya existían).
WITH wanted(code, c, r, u, d) AS (
  VALUES
    ('dashboard',        false, true, false, false),
    ('staff',            true,  true, true,  true),
    ('evaluation_plans', true,  true, true,  true),
    ('schedules',        true,  true, true,  true)
)
UPDATE role_permissions rp
SET can_create = w.c, can_read = w.r, can_update = w.u, can_delete = w.d, extra_actions = '{}'::jsonb
FROM roles r, modules m, wanted w
WHERE r.id = rp.role_id AND m.id = rp.module_id AND m.code = w.code
  AND r.name = 'Coordinador' AND r.is_system;

WITH wanted(code, c, r, u, d) AS (
  VALUES
    ('dashboard',        false, true, false, false),
    ('staff',            true,  true, true,  true),
    ('evaluation_plans', true,  true, true,  true),
    ('schedules',        true,  true, true,  true)
)
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, m.id, w.c, w.r, w.u, w.d, '{}'::jsonb
FROM roles r
CROSS JOIN wanted w
JOIN modules m ON m.code = w.code
WHERE r.name = 'Coordinador' AND r.is_system
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = m.id);
