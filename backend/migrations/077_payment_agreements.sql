-- =====================================================================
-- 077 — Acuerdo de pago por alumno (días de gracia)
--
-- La fecha límite estándar de cada mensualidad sale de la tarifa del nivel
-- (tuition_fees.due_day: «vence el día 5»). Un alumno puede tener un acuerdo
-- especial que le da días adicionales:
--
--   students.payment_grace_days   NULL = sin acuerdo (plazo estándar del nivel);
--                                 1–60 = días que se suman a la fecha límite
--   students.payment_agreement_note  motivo / referencia del acuerdo
--   students.payment_agreement_at    cuándo se asignó
--
-- El plazo se aplica a la FECHA LÍMITE de la mensualidad (payments.due_date):
-- al generarla y, al cambiar el acuerdo, a las pendientes desde el mes en
-- curso. Así todo lo que decide si una cuota está vencida (estado, panel,
-- recordatorios, solvencia, bloqueo del portal) lo respeta sin cambios, y la
-- familia ve su fecha límite real.
--
--   payments.grace_days   días de gracia ya aplicados a esa mensualidad
--                         (para recalcular sin acumular al cambiar el acuerdo)
-- =====================================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS payment_grace_days SMALLINT,
  ADD COLUMN IF NOT EXISTS payment_agreement_note VARCHAR(200),
  ADD COLUMN IF NOT EXISTS payment_agreement_at TIMESTAMPTZ;

ALTER TABLE students DROP CONSTRAINT IF EXISTS ck_students_payment_grace_days;
ALTER TABLE students ADD CONSTRAINT ck_students_payment_grace_days
  CHECK (payment_grace_days IS NULL OR payment_grace_days BETWEEN 1 AND 60);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS grace_days SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_students_payment_agreement ON students (tenant_id) WHERE payment_grace_days IS NOT NULL;
