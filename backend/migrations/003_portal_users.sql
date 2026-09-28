-- =====================================================================
-- 003 — Usuarios del portal para representantes
--
-- Los representantes inician sesión con su correo electrónico como
-- `username` (en minúsculas). Un correo puede medir hasta 150 caracteres
-- (igual que guardians.email / staff.email), así que se amplía la columna.
-- La unicidad sigue siendo por colegio: UNIQUE (tenant_id, username).
-- =====================================================================

ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(150);

-- Un usuario del portal pertenece a un solo representante.
CREATE UNIQUE INDEX ux_guardians_user ON guardians(user_id) WHERE user_id IS NOT NULL;
