-- =====================================================================
-- 007 — Tasa de cambio BCV (USD → Bs) y monto en bolívares de los pagos
--
-- exchange_rates   tasa oficial por "fecha valor" (como la publica el BCV).
--                  La tasa VIGENTE en un día D es la de mayor rate_date <= D:
--                  el BCV publica hoy la tasa que rige desde el próximo día hábil,
--                  y un fin de semana sigue rigiendo la del viernes.
-- payments         + exchange_rate / exchange_rate_date / amount_ves:
--                  foto de la conversión al CONFIRMAR el pago (un recibo no puede
--                  cambiar de valor cuando cambia la tasa). Mientras está pendiente
--                  el monto en Bs se calcula al consultar con la tasa vigente.
-- =====================================================================

CREATE TABLE exchange_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency   VARCHAR(10) NOT NULL DEFAULT 'USD',
  quote_currency  VARCHAR(10) NOT NULL DEFAULT 'VES',
  rate_date       DATE NOT NULL,                              -- fecha valor
  rate            NUMERIC(20,8) NOT NULL CHECK (rate > 0),    -- Bs por 1 USD (el BCV publica 8 decimales)
  source          VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bcv')),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, base_currency, quote_currency, rate_date)
);

CREATE INDEX idx_exchange_rates_lookup
  ON exchange_rates (tenant_id, base_currency, quote_currency, rate_date DESC);

ALTER TABLE payments
  ADD COLUMN exchange_rate       NUMERIC(20,8) CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  ADD COLUMN exchange_rate_date  DATE,
  ADD COLUMN amount_ves          NUMERIC(16,2) CHECK (amount_ves IS NULL OR amount_ves >= 0);

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchange_rates
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
