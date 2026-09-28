-- =====================================================================
-- 004 — Mensualidades automáticas
--
-- tuition_fees      tarifa mensual por año escolar (y opcionalmente por nivel)
-- payments          + columnas de mensualidad: mes facturado, emisión, vencimiento
--                   + reporte de pago del representante (queda "en revisión")
--                   + estado 'cancelled' (mensualidades anuladas, ej. por retiro)
--
-- El estado "vencido" / "programado" NO se guarda: se calcula en cada consulta
-- con la fecha actual (ver payment.service.js → DISPLAY_STATUS_SQL). Así no se
-- necesita una tarea programada para ir venciendo pagos día a día.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tarifas
-- ---------------------------------------------------------------------

CREATE TABLE tuition_fees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  school_period_id  UUID NOT NULL REFERENCES school_periods(id) ON DELETE CASCADE,
  level_code        VARCHAR(20) REFERENCES education_levels(code), -- NULL = tarifa general del año
  amount            NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency          VARCHAR(10) NOT NULL DEFAULT 'USD',
  due_day           SMALLINT NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 28),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una tarifa general y, como máximo, una por nivel en cada año escolar.
CREATE UNIQUE INDEX ux_tuition_fees_scope
  ON tuition_fees (tenant_id, school_period_id, COALESCE(level_code, '*'));

-- ---------------------------------------------------------------------
-- 2. Pagos: columnas de mensualidad y de reporte
-- ---------------------------------------------------------------------

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled'));

ALTER TABLE payments
  ADD COLUMN kind              VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (kind IN ('tuition', 'other')),
  ADD COLUMN enrollment_id     UUID REFERENCES enrollments(id) ON DELETE SET NULL,
  ADD COLUMN school_period_id  UUID REFERENCES school_periods(id) ON DELETE SET NULL,
  ADD COLUMN billing_month     DATE,          -- primer día del mes facturado
  ADD COLUMN issue_date        DATE,          -- desde cuándo es exigible
  ADD COLUMN due_date          DATE,          -- fecha límite (por defecto el día 5)
  ADD COLUMN reported_at       TIMESTAMPTZ,   -- el representante informó que pagó
  ADD COLUMN report_method     VARCHAR(30),
  ADD COLUMN report_reference  VARCHAR(60),
  ADD COLUMN report_paid_on    DATE,
  ADD COLUMN report_note       VARCHAR(300),
  ADD COLUMN cancelled_at      TIMESTAMPTZ,
  ADD CONSTRAINT payments_tuition_fields CHECK (
    kind <> 'tuition'
    OR (billing_month IS NOT NULL AND issue_date IS NOT NULL AND due_date IS NOT NULL AND school_period_id IS NOT NULL)
  ),
  ADD CONSTRAINT payments_billing_month_first_day CHECK (
    billing_month IS NULL OR billing_month = date_trunc('month', billing_month)::date
  ),
  ADD CONSTRAINT payments_due_after_issue CHECK (due_date IS NULL OR issue_date IS NULL OR due_date >= issue_date);

-- Nunca dos mensualidades del mismo mes para el mismo alumno en el mismo año
-- escolar: hace idempotente la generación (INSERT ... ON CONFLICT).
CREATE UNIQUE INDEX ux_payments_tuition_month
  ON payments (student_id, school_period_id, billing_month)
  WHERE kind = 'tuition';

CREATE INDEX idx_payments_tenant_due ON payments (tenant_id, due_date) WHERE status = 'pending';
CREATE INDEX idx_payments_guardian ON payments (guardian_id);

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------

ALTER TABLE tuition_fees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tuition_fees
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
