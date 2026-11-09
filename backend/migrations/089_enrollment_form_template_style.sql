-- =====================================================================
-- 089 · Plantilla de diseño del PDF de cada planilla de inscripción
--
--   template_style   classic | modern | compact | institutional | minimal
--
-- Las planillas que ya existen quedan en 'compact', la más parecida al diseño
-- que venían usando: nadie ve cambiar sus documentos sin haberlo elegido. Las
-- nuevas nacen en 'classic'. El diseño de cada una está en
-- services/pdf/enrollmentFormGenerator.js.
-- =====================================================================

ALTER TABLE enrollment_forms
  ADD COLUMN IF NOT EXISTS template_style VARCHAR(20) NOT NULL DEFAULT 'compact';

ALTER TABLE enrollment_forms ALTER COLUMN template_style SET DEFAULT 'classic';

ALTER TABLE enrollment_forms DROP CONSTRAINT IF EXISTS ck_enrollment_forms_template_style;
ALTER TABLE enrollment_forms
  ADD CONSTRAINT ck_enrollment_forms_template_style
  CHECK (template_style IN ('classic', 'modern', 'compact', 'institutional', 'minimal'));
