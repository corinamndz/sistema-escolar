-- =====================================================================
-- 092 · Publicar el certificado para las familias
--
-- El colegio diseña su certificado sin que nadie lo vea y decide cuándo lo pueden
-- descargar las familias en el portal. NULL = sin publicar. No afecta a la emisión
-- desde Cierre y promoción, que sigue disponible para la administración.
-- =====================================================================

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id) ON DELETE SET NULL;
