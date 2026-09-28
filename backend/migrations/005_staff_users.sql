-- =====================================================================
-- 005 — Usuario de acceso del personal
--
-- `staff.user_id` ya existía (001). Aquí solo se garantiza que un usuario
-- pertenezca a UN empleado, igual que con los representantes (003).
-- El usuario se crea/gestiona desde el módulo de Personal
-- (ver src/modules/staff/staffAccess.service.js).
-- =====================================================================

CREATE UNIQUE INDEX ux_staff_user ON staff(user_id) WHERE user_id IS NOT NULL;
