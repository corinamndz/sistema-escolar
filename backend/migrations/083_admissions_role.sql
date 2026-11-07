-- =====================================================================
-- 083 · Rol Admisiones
--
-- Personal de admisiones / control de estudios: gestiona el proceso de
-- inscripción y nada más.
--
--   Planillas de inscripción (enrollment_forms)   diseño (Form Builder), bandeja,
--                                                  revisión, aprobación y rechazo
--   Alumnos (students)                             SOLO CONSULTA: listado y ficha
--                                                  para verificar el estatus
--                                                  «Inscrito / No inscrito»
--
-- Las rutas de planillas se validan por ROL (Administrador o Admisiones,
-- middlewares/admin.middleware.js → requireAdmissions), no por el permiso de
-- módulo: así ningún otro rol entra aunque tenga ese permiso cargado. Aprobar
-- da de alta al alumno, sus representantes y la matrícula desde esas mismas
-- rutas, sin necesitar permisos de Alumnos, Representantes ni Académico.
--
-- Sin Pagos, Configuración, Personal, Roles, Auditoría… (sin permiso de
-- módulo → 403), ni panel de inicio: al entrar va a «Planillas recibidas».
-- Fuera de la jerarquía (hierarchy_level NULL): solo el Director lo asigna.
-- Si el colegio ya tiene un rol propio llamado "Admisiones", no se toca.
-- =====================================================================

INSERT INTO roles (tenant_id, name, is_system, hierarchy_level)
SELECT t.id, 'Admisiones', true, NULL
FROM tenants t
WHERE t.id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND lower(r.name) = 'admisiones');

WITH wanted(code, c, r, u, d) AS (
  VALUES
    ('enrollment_forms', true,  true, true,  true),
    ('students',         false, true, false, false)
)
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, m.id, w.c, w.r, w.u, w.d, '{}'::jsonb
FROM roles r
CROSS JOIN wanted w
JOIN modules m ON m.code = w.code
WHERE r.name = 'Admisiones'
  AND r.is_system
  AND r.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = m.id);
