-- =====================================================================
-- 096 · Mini-sitio web institucional de cada colegio
--
-- Una fila por colegio con lo que muestra su página pública (/colegio/<slug>).
-- El nombre, el logo, el teléfono, el correo y la dirección NO se repiten aquí:
-- se toman de Configuración (tenant_settings), para que haya un solo lugar donde
-- cambiarlos. Los colores, si quedan NULL, también son los del colegio.
--
--   tagline           eslogan (bajo el nombre)
--   primary_color /
--   secondary_color   colores propios del sitio ('#rrggbb') o NULL
--   banner_url        imagen de portada (/storage/website/...)
--   history           reseña histórica · mission · vision
--   gallery           [{ url, caption }] fotos institucionales (/storage/website/...)
--   social            { facebook, instagram, x, youtube, tiktok, whatsapp, website }
--   show_contact      mostrar teléfono, correo y dirección del colegio
--   is_published      visible para el público; sin publicar, la URL responde 404
-- La lógica está en modules/website/website.service.js.
-- =====================================================================

CREATE TABLE IF NOT EXISTS school_websites (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tagline          VARCHAR(160),
  primary_color    VARCHAR(7) CHECK (primary_color IS NULL OR primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color  VARCHAR(7) CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  banner_url       TEXT,
  history          TEXT,
  mission          TEXT,
  vision           TEXT,
  gallery          JSONB NOT NULL DEFAULT '[]'::jsonb,
  social           JSONB NOT NULL DEFAULT '{}'::jsonb,
  show_contact     BOOLEAN NOT NULL DEFAULT true,
  is_published     BOOLEAN NOT NULL DEFAULT false,
  published_at     TIMESTAMPTZ,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_websites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_websites;
CREATE POLICY tenant_isolation ON school_websites USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
