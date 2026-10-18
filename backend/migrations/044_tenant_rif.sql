-- =====================================================================
-- 044 · RIF del colegio
--
-- Registro de Información Fiscal de la institución, para los comprobantes
-- de pago y la identificación formal del colegio. Se guarda normalizado:
-- letra del tipo de contribuyente, 8 dígitos y el dígito verificador,
-- separados por guiones (ej. J-12345678-9). Opcional.
-- =====================================================================

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS rif VARCHAR(12);

ALTER TABLE tenant_settings
  ADD CONSTRAINT ck_tenant_settings_rif CHECK (rif IS NULL OR rif ~ '^[JGVEPC]-[0-9]{8}-[0-9]$');

COMMENT ON COLUMN tenant_settings.rif IS 'RIF del colegio, normalizado como J-12345678-9 (se muestra en los comprobantes de pago).';
