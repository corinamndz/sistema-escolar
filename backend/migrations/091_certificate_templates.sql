-- =====================================================================
-- 091 · Certificado de promoción, diseñado por cada colegio
--
-- Una plantilla por colegio (tenant_id es el identificador del colegio en todo
-- el sistema):
--
--   background_path/type   fondo subido: png, jpg o pdf (se usa su primera página)
--   page_width/height      tamaño de la hoja en puntos PDF
--   fields                 las variables colocadas sobre el fondo:
--     [{ "key": "student_name", "x": 0.5, "y": 0.42, "fontSize": 28,
--        "color": "#0f172a", "align": "center", "font": "times", "bold": true }]
--     x, y son FRACCIONES de la hoja (0 a 1), así valen igual en el editor, a
--     cualquier tamaño de pantalla, y en el PDF. `x` es el punto de anclaje según
--     la alineación; `y`, el centro vertical de la línea de texto.
--
-- La lógica está en certificates/certificate.service.js.
-- =====================================================================

CREATE TABLE IF NOT EXISTS certificate_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  background_path  VARCHAR(255) NOT NULL,
  background_type  VARCHAR(4) NOT NULL CHECK (background_type IN ('png', 'jpg', 'pdf')),
  page_width       NUMERIC(8,2) NOT NULL CHECK (page_width > 0),
  page_height      NUMERIC(8,2) NOT NULL CHECK (page_height > 0),
  fields           JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fields) = 'array'),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON certificate_templates;
CREATE POLICY tenant_isolation ON certificate_templates USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
