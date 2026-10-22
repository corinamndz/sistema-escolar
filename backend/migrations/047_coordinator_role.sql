-- =====================================================================
-- 047 · Rol Coordinador y jerarquía de roles
--
-- Jerarquía formal (roles.hierarchy_level; menor número = más autoridad):
--   1  Administrador   (Director: acceso total)
--   2  Coordinador     (gestiona a los docentes de su etapa)
--   3  Docente
--   NULL  Representante y roles personalizados (fuera de la jerarquía)
-- Un usuario solo puede asignar roles de nivel INFERIOR al suyo; el
-- Director (quien edita roles) asigna cualquiera.
--
-- staff.coordination_level   etapa que coordina: initial | primary | secondary
--   (solo tiene sentido para quien tiene el rol Coordinador). El coordinador
--   ve y gestiona en Personal a los DOCENTES disponibles para su etapa
--   (staff.level_availability = su etapa o 'all').
-- =====================================================================

ALTER TABLE roles ADD COLUMN IF NOT EXISTS hierarchy_level SMALLINT CHECK (hierarchy_level IS NULL OR hierarchy_level BETWEEN 1 AND 9);
COMMENT ON COLUMN roles.hierarchy_level IS 'Jerarquía: 1 Director (Administrador) > 2 Coordinador > 3 Docente. NULL = fuera de la jerarquía.';

UPDATE roles SET hierarchy_level = 1 WHERE is_system AND name = 'Administrador';
UPDATE roles SET hierarchy_level = 3 WHERE is_system AND name = 'Docente';

ALTER TABLE staff ADD COLUMN IF NOT EXISTS coordination_level VARCHAR(10)
  CHECK (coordination_level IS NULL OR coordination_level IN ('initial', 'primary', 'secondary'));
COMMENT ON COLUMN staff.coordination_level IS 'Etapa que coordina (rol Coordinador): initial, primary o secondary.';

-- ---------------------------------------------------------------------
-- Rol Coordinador en cada colegio, con sus permisos
-- ---------------------------------------------------------------------
INSERT INTO roles (tenant_id, name, is_system, hierarchy_level)
SELECT t.id, 'Coordinador', true, 2
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.name = 'Coordinador');

UPDATE roles SET hierarchy_level = 2, is_system = true WHERE name = 'Coordinador';

-- Personal: gestión completa (el servicio la limita a los docentes de su etapa).
-- Resto: consulta, para supervisar su área. Calificaciones con "ver todas las
-- secciones" (no queda restringido a una carga docente propia).
INSERT INTO role_permissions (tenant_id, role_id, module_id, can_create, can_read, can_update, can_delete, extra_actions)
SELECT r.tenant_id, r.id, m.id,
       m.code = 'staff', true, m.code = 'staff', m.code = 'staff',
       CASE WHEN m.code = 'grading' THEN '{"view_all_sections": true}'::jsonb ELSE '{}'::jsonb END
FROM roles r
JOIN modules m ON m.code IN ('dashboard', 'staff', 'students', 'guardians', 'academics', 'evaluation_plans', 'grading', 'schedules', 'discipline', 'clubs', 'events', 'appointments')
WHERE r.name = 'Coordinador'
  AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.module_id = m.id);
