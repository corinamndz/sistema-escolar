-- =====================================================================
-- 066 · Vistas del portal del representante
--
-- tenant_settings.portal_views   qué secciones del portal de padres están
--   activas, como { "payments": true, "recognitions": false, … }.
--   Una clave AUSENTE cuenta como ACTIVA: las vistas nuevas aparecen
--   encendidas sin migrar datos, y un colegio que nunca configuró nada ve
--   el portal completo, como hasta ahora.
--
-- Catálogo de claves: backend/src/modules/tenants/portalViews.service.js
-- (menú, pestañas de la ficha del alumno y bloques del inicio). El backend
-- aplica la configuración en las rutas del portal (403), no solo en el menú.
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS portal_views JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_settings_portal_views' AND conrelid = 'tenant_settings'::regclass) THEN
    ALTER TABLE tenant_settings ADD CONSTRAINT ck_tenant_settings_portal_views CHECK (jsonb_typeof(portal_views) = 'object');
  END IF;
END $$;
