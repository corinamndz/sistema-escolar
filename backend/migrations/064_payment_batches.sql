-- =====================================================================
-- 064 · Pagos agrupados (multi-alumno / multi-concepto)
--
-- Un representante paga VARIAS cuotas (de uno o varios hijos) en una sola
-- operación y sube UN comprobante por el total:
--
--   payment_batches        el pago agrupado: quién, total, cómo pagó y su
--                          comprobante. Estados:
--                            reported   enviado por la familia, en revisión
--                            approved   la administración lo aprobó: todas sus
--                                       cuotas quedaron pagadas (con su recibo)
--                            rejected   la administración lo rechazó (motivo)
--                            withdrawn  la familia lo retiró para corregirlo
--   payment_batch_items    las cuotas incluidas (1 pago agrupado → N cuotas),
--                          con el monto de cada una al momento de reportar
--   payments.batch_id      el pago agrupado en revisión que incluye la cuota
--                          (NULL si no está en ninguno); la cuota se ve
--                          "reportada" mientras tanto
--
-- La aprobación confirma cada cuota en la MISMA transacción (si una falla,
-- no se confirma ninguna), con la tasa de la fecha de pago y su recibo PDF.
-- =====================================================================

CREATE TABLE IF NOT EXISTS payment_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guardian_id         UUID NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
  status              VARCHAR(10) NOT NULL DEFAULT 'reported'
                        CHECK (status IN ('reported', 'approved', 'rejected', 'withdrawn')),
  -- Total en la moneda de las cuotas (todas en la misma, normalmente USD).
  base_currency       VARCHAR(10) NOT NULL,
  base_total          NUMERIC(12,2) NOT NULL CHECK (base_total > 0),
  item_count          SMALLINT NOT NULL CHECK (item_count > 0),
  -- Moneda en que pagó y total en esa moneda: estimado al reportar, definitivo al aprobar.
  ref_currency        VARCHAR(10),
  ref_total           NUMERIC(18,2),
  method              VARCHAR(20) NOT NULL,
  reference           VARCHAR(60),
  paid_on             DATE NOT NULL,
  note                VARCHAR(300),
  proof_path          TEXT,
  proof_mime          VARCHAR(100),
  proof_original_name VARCHAR(255),
  proof_size          INTEGER,
  proof_uploaded_at   TIMESTAMPTZ,
  reported_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  rejection_reason    VARCHAR(300),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_payment_batches_status ON payment_batches (tenant_id, status, reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_batches_guardian ON payment_batches (tenant_id, guardian_id, reported_at DESC);

CREATE TABLE IF NOT EXISTS payment_batch_items (
  batch_id    UUID NOT NULL REFERENCES payment_batches(id) ON DELETE CASCADE,
  payment_id  UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL,
  currency    VARCHAR(10) NOT NULL,
  PRIMARY KEY (batch_id, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_batch_items_payment ON payment_batch_items (payment_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES payment_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_batch ON payments (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_batches;
CREATE POLICY tenant_isolation ON payment_batches USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE payment_batch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payment_batch_items;
CREATE POLICY tenant_isolation ON payment_batch_items USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
