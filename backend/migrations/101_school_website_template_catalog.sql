-- =====================================================================
-- 101 · Catálogo ampliado de plantillas del sitio web
--
-- Las plantillas viven en CÓDIGO (un catálogo declarativo: portada, secciones,
-- galería, agenda, accesos rápidos, bienvenida y tipografía; ver
-- frontend/src/features/website/templates.js y website.service.js TEMPLATES).
-- La base solo guarda la CLAVE elegida y el contenido del colegio, así que
-- agregar una plantilla nueva no requiere migrar datos: solo ampliar esta lista.
--
--   template            10 plantillas (antes 4)
--   font                tipografía elegida por el colegio; NULL = la de la plantilla
--   welcome_title/_text/_signature   banner de bienvenida (p. ej. mensaje de la
--                       Dirección); sin texto, el banner no aparece
--   show_quick_links    bloque «Accesos rápidos» para familias y docentes
--                       (portal, solicitud de cupo, agenda, contacto)
-- =====================================================================

ALTER TABLE school_websites DROP CONSTRAINT IF EXISTS school_websites_template_check;
ALTER TABLE school_websites ADD CONSTRAINT school_websites_template_check
  CHECK (template IN ('classic', 'modern', 'minimal', 'academic', 'prestige', 'playful', 'magazine', 'portal', 'showcase', 'contrast'));

ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS font VARCHAR(20);
ALTER TABLE school_websites DROP CONSTRAINT IF EXISTS school_websites_font_check;
ALTER TABLE school_websites ADD CONSTRAINT school_websites_font_check CHECK (font IS NULL OR font IN ('sans', 'serif', 'rounded', 'elegant'));

ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS welcome_title VARCHAR(120);
ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS welcome_text TEXT;
ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS welcome_signature VARCHAR(120);
ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS show_quick_links BOOLEAN NOT NULL DEFAULT true;
