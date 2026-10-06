-- =====================================================================
-- 021 · Apariencia avanzada del colegio
--
-- Los dos colores base ya existían:
--   secondary_color  color del MENÚ lateral (base del degradado)
--   primary_color    color de ACENTO (botones, encabezados de tabla, bordes
--                    activos, elementos interactivos)
-- Todo lo demás (degradado, hover, fondos suaves, texto legible encima,
-- variante accesible para texto) se calcula en el frontend a partir de ellos.
-- Aquí solo se guardan las preferencias que el usuario elige:
--   menu_gradient       cómo se calcula el degradado del menú:
--                         deep      mismo tono, más profundo (por defecto)
--                         analogous tono vecino armónico
--                         solid     color plano, sin degradado
--   accent2_color       acento secundario opcional (NULL = automático)
--   table_header_style  encabezados de tabla: subtle (tinte del acento),
--                       solid (acento pleno) o neutral (gris)
-- =====================================================================

ALTER TABLE tenant_settings
  ADD COLUMN menu_gradient VARCHAR(12) NOT NULL DEFAULT 'deep'
    CHECK (menu_gradient IN ('deep', 'analogous', 'solid')),
  ADD COLUMN accent2_color VARCHAR(7)
    CHECK (accent2_color IS NULL OR accent2_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN table_header_style VARCHAR(10) NOT NULL DEFAULT 'subtle'
    CHECK (table_header_style IN ('subtle', 'solid', 'neutral'));
