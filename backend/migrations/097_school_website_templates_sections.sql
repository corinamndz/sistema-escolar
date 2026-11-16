-- =====================================================================
-- 097 · Mini-sitio: plantilla de diseño y secciones adicionales
--
--   template   distribución de la página pública:
--                classic   portada centrada con degradado, bloques en columna
--                modern    portada grande a pantalla completa, secciones alternadas
--                minimal   portada clara y sobria, mucho espacio, una columna
--                academic  portada dividida (texto | foto), misión y visión primero
--   sections   secciones adicionales, EN SU ORDEN de aparición:
--                [{ id, title, body_html, image_url, visible }]
--              body_html llega saneado por el servidor (lista blanca, sin <img>:
--              la imagen de cada sección es image_url, subida al colegio).
-- La lógica está en modules/website/website.service.js.
-- =====================================================================

ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS template VARCHAR(20) NOT NULL DEFAULT 'classic';
ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_websites_template_check' AND conrelid = 'school_websites'::regclass) THEN
    ALTER TABLE school_websites ADD CONSTRAINT school_websites_template_check CHECK (template IN ('classic', 'modern', 'minimal', 'academic'));
  END IF;
END $$;
