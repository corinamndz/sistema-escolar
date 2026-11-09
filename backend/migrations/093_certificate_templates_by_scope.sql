-- =====================================================================
-- 093 · Diseños de certificado por año escolar y por nivel educativo
--
-- Antes: un diseño por colegio. Ahora, varios, cada uno con su alcance:
--
--   school_period_id   el año escolar al que aplica   (NULL = todos los años)
--   level_code         el nivel educativo al que aplica (NULL = todos los niveles)
--
-- El diseño que ya tenía cada colegio queda como su DISEÑO GENERAL (NULL, NULL):
-- nadie pierde su certificado. Al emitir, se usa el diseño más específico que
-- exista para el año y el nivel del alumno, en este orden:
--     año y nivel  →  año, todos los niveles  →  nivel, todos los años  →  general
-- (certificates/certificate.service.js, resolveFor).
--
-- Si se elimina un año escolar, sus diseños propios se eliminan con él.
-- =====================================================================

ALTER TABLE certificate_templates
  ADD COLUMN IF NOT EXISTS school_period_id UUID REFERENCES school_periods(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS level_code VARCHAR(20) REFERENCES education_levels(code) ON UPDATE CASCADE;

-- Un diseño por colegio, año y nivel (los NULL también cuentan: un solo general).
ALTER TABLE certificate_templates DROP CONSTRAINT IF EXISTS certificate_templates_tenant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificate_templates_scope
  ON certificate_templates (tenant_id, school_period_id, level_code) NULLS NOT DISTINCT;
