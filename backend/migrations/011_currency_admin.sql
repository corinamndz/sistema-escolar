-- =====================================================================
-- 011 — Administración de monedas por colegio
--
-- `currencies` (010) sigue siendo el catálogo GLOBAL de referencia (códigos
-- ISO 4217 válidos, compartido por todos los colegios): un colegio no lo
-- modifica, porque cambiaría las monedas de los demás.
--
-- Lo que administra cada colegio vive en `tenant_currencies`:
--   name / symbol / decimals   personalización propia (NULL = usar el catálogo)
--   is_active                  activar / desactivar sin perder tasas ni historial
--   is_default                 moneda predeterminada (debe estar activa)
-- =====================================================================

-- Catálogo: más monedas de la región (y el euro, que el BCV también publica).
INSERT INTO currencies (code, name, country, symbol, decimals, locale, official_source, sort_order) VALUES
  ('HNL', 'Lempira',     'Honduras',       'L',    2, 'es-HN', NULL, 14),
  ('NIO', 'Córdoba',     'Nicaragua',      'C$',   2, 'es-NI', NULL, 15),
  ('PAB', 'Balboa',      'Panamá',         'B/.',  2, 'es-PA', NULL, 16),
  ('CUP', 'Peso cubano', 'Cuba',           'CUP$', 2, 'es-CU', NULL, 17),
  ('HTG', 'Gourde',      'Haití',          'G',    2, 'fr-HT', NULL, 18),
  ('EUR', 'Euro',        'Unión Europea',  '€',    2, 'es-ES', NULL, 30)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE tenant_currencies
  ADD COLUMN name       VARCHAR(60) CHECK (name IS NULL OR length(trim(name)) > 0),
  ADD COLUMN symbol     VARCHAR(8)  CHECK (symbol IS NULL OR length(trim(symbol)) > 0),
  ADD COLUMN decimals   SMALLINT    CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 2),
  ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- La predeterminada siempre debe estar activa (es la que ven todos por defecto).
ALTER TABLE tenant_currencies
  ADD CONSTRAINT ck_tenant_currencies_default_active CHECK (NOT is_default OR is_active);
