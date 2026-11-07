-- 082: planilla «Por llenar» generada al promover.
--
-- Al promover (o hacer repetir) a un alumno al año escolar nuevo, se crea en la
-- misma transacción un registro en enrollment_form_submissions con estado
-- 'pending': la planilla de ese año queda asignada a su representante
-- principal, vacía, hasta que la complete y la envíe (pasa a 'submitted').
--
--   status 'pending'   asignada, aún sin llenar (sin respuestas ni fecha de envío)
--   enrollment_id      matrícula del año nuevo que la originó; al deshacer la
--                      promoción se borra si sigue sin llenar

ALTER TABLE enrollment_form_submissions DROP CONSTRAINT IF EXISTS enrollment_form_submissions_status_check;
ALTER TABLE enrollment_form_submissions DROP CONSTRAINT IF EXISTS ck_enrollment_submission_status;
ALTER TABLE enrollment_form_submissions
  ADD CONSTRAINT ck_enrollment_submission_status CHECK (status IN ('pending', 'submitted', 'changes_requested', 'approved', 'rejected'));

-- Una planilla por llenar todavía no se ha enviado.
ALTER TABLE enrollment_form_submissions ALTER COLUMN submitted_at DROP NOT NULL;
ALTER TABLE enrollment_form_submissions DROP CONSTRAINT IF EXISTS ck_enrollment_submission_sent;
ALTER TABLE enrollment_form_submissions
  ADD CONSTRAINT ck_enrollment_submission_sent CHECK (status = 'pending' OR submitted_at IS NOT NULL);
-- Solo se generan para alumnos registrados.
ALTER TABLE enrollment_form_submissions DROP CONSTRAINT IF EXISTS ck_enrollment_submission_pending_student;
ALTER TABLE enrollment_form_submissions
  ADD CONSTRAINT ck_enrollment_submission_pending_student CHECK (status <> 'pending' OR student_id IS NOT NULL);

ALTER TABLE enrollment_form_submissions ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_enrollment_submissions_enrollment ON enrollment_form_submissions (enrollment_id) WHERE enrollment_id IS NOT NULL;
