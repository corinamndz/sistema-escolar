-- =====================================================================
-- 099 · Eventos de la cartelera en el sitio web público del colegio
--
--   school_events.show_on_website   el evento aparece en «Próximos eventos» del
--                                   mini-sitio (/colegio/<slug>). Opción EXPLÍCITA
--                                   (false por defecto): un evento interno, como
--                                   la reunión de padres de una sección, no se
--                                   publica en internet solo por estar en la cartelera.
-- En la web se ven los eventos publicados (is_published), marcados aquí y con
-- fecha de hoy en adelante. Se consultan en vivo: crear, editar o borrar un
-- evento cambia el sitio al instante (website.service.js, event.service.js).
-- =====================================================================

ALTER TABLE school_events ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_school_events_website ON school_events (tenant_id, event_date) WHERE show_on_website AND is_published;
