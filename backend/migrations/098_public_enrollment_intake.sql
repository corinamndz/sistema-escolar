-- =====================================================================
-- 098 · Solicitud de cupo desde el sitio web público
--
-- Una planilla de inscripción puede funcionar también como «Solicitud de cupo»
-- en el mini-sitio del colegio (/colegio/<slug>): cualquiera la llena SIN cuenta.
--
--   enrollment_forms.public_intake   esta planilla se publica en la web (una por colegio)
--   enrollment_form_submissions.source
--       portal   la envió un representante con cuenta (todas las anteriores)
--       web      llegó por el sitio público: no hay representante con cuenta
--   .web_contact  { name, national_id, phone, email } de quien solicita (solo web)
--   .web_meta     { ip, user_agent } para rastrear abusos (solo web)
--   guardian_id   deja de ser obligatorio, SOLO para las de la web.
-- La lógica está en enrollment-forms/publicIntake.service.js.
-- =====================================================================

ALTER TABLE enrollment_forms ADD COLUMN IF NOT EXISTS public_intake BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_forms_public_intake ON enrollment_forms (tenant_id) WHERE public_intake;

ALTER TABLE enrollment_form_submissions ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'portal';
ALTER TABLE enrollment_form_submissions ADD COLUMN IF NOT EXISTS web_contact JSONB;
ALTER TABLE enrollment_form_submissions ADD COLUMN IF NOT EXISTS web_meta JSONB;
ALTER TABLE enrollment_form_submissions ALTER COLUMN guardian_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrollment_submissions_source_check' AND conrelid = 'enrollment_form_submissions'::regclass) THEN
    ALTER TABLE enrollment_form_submissions ADD CONSTRAINT enrollment_submissions_source_check CHECK (source IN ('portal', 'web'));
  END IF;
  -- Sin representante con cuenta solo puede llegar una solicitud web, y siempre con su contacto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'enrollment_submissions_guardian_or_web' AND conrelid = 'enrollment_form_submissions'::regclass) THEN
    ALTER TABLE enrollment_form_submissions ADD CONSTRAINT enrollment_submissions_guardian_or_web CHECK (guardian_id IS NOT NULL OR (source = 'web' AND web_contact IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_enrollment_submissions_source ON enrollment_form_submissions (tenant_id, source);
