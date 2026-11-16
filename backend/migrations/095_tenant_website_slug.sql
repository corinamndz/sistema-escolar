-- migrate:scope public
-- =====================================================================
-- 095 · Dirección pública del mini-sitio de cada colegio
--
-- El sitio público se abre en /colegio/<slug>, SIN sesión: hay que encontrar
-- el colegio por su slug antes de saber cuál es, así que el slug personalizado
-- vive en la tabla global `tenants` (sin RLS), igual que el slug del colegio.
--
--   website_slug   identificador elegido por el colegio (p. ej. colegio-san-jose);
--                  NULL = se usa tenants.slug. Único entre todos los colegios y
--                  distinto del slug de cualquier OTRO colegio (lo valida el
--                  servicio: modules/website/website.service.js).
-- El contenido del sitio está en school_websites (096), dentro de cada colegio.
-- =====================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website_slug VARCHAR(60);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_website_slug ON tenants (website_slug) WHERE website_slug IS NOT NULL;
