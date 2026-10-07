-- =====================================================================
-- 022 · Convivencia: niveles de gravedad Leve · Media · Grave
--
-- Antes: leve | grave | gravisima. Ahora: leve | media | grave.
--   - "gravisima" desaparece: las sanciones que la tuvieran pasan a "grave",
--     que vuelve a ser el nivel más alto (no se pierde ningún registro).
--   - "media" es el nuevo nivel intermedio.
-- =====================================================================

ALTER TABLE student_sanctions DROP CONSTRAINT IF EXISTS student_sanctions_severity_check;

UPDATE student_sanctions SET severity = 'grave', updated_at = now() WHERE severity = 'gravisima';

ALTER TABLE student_sanctions
  ADD CONSTRAINT student_sanctions_severity_check CHECK (severity IN ('leve', 'media', 'grave'));

COMMENT ON COLUMN student_sanctions.severity IS 'Gravedad de la falta: leve | media | grave';
