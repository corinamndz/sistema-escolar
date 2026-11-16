-- =====================================================================
-- 100 · Galería del sitio web como carrusel
--
--   school_websites.gallery_autoplay   el carrusel de fotos avanza solo (cada
--                                      pocos segundos; se detiene al pasar el
--                                      mouse, al enfocarlo o con el botón de pausa,
--                                      y nunca si el visitante pidió reducir el
--                                      movimiento). Opcional: apagado por defecto.
-- =====================================================================

ALTER TABLE school_websites ADD COLUMN IF NOT EXISTS gallery_autoplay BOOLEAN NOT NULL DEFAULT false;
