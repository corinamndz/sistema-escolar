-- =====================================================================
-- 079 — Dirección física del colegio
--
-- Datos institucionales de la Configuración: nombre (tenants.name), RIF y
-- logo (tenant_settings.rif / logo_url) ya existían; falta la dirección,
-- que encabeza los documentos oficiales (membrete de las planillas de
-- inscripción en PDF).
-- =====================================================================

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS address VARCHAR(300);
