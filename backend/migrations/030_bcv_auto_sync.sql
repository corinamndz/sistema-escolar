-- =====================================================================
-- 030 · Tasa BCV automática: fuente de respaldo y estado de sincronización
--
--   exchange_rates.source   + 'bcv_api': tasa oficial del BCV obtenida de
--                           una API pública que la replica (respaldo cuando
--                           la página del BCV no responde). 'bcv' sigue
--                           siendo la consulta directa a www.bcv.org.ve.
--
--   exchange_rate_sync      último intento de sincronización por colegio:
--     last_attempt_at       cuándo se consultó por última vez
--     last_success_at       cuándo se obtuvo y guardó una tasa por última vez
--     last_status           ok | error
--     last_error            motivo del último fallo (si el último fue error)
--     last_source           bcv | bcv_api (de dónde salió la última tasa)
--     last_rate / last_rate_date   la última tasa obtenida y su fecha valor
--     last_trigger          auto (tarea programada) | manual (botón)
-- =====================================================================

ALTER TABLE exchange_rates DROP CONSTRAINT IF EXISTS exchange_rates_source_check;
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_source_check CHECK (source IN ('manual', 'bcv', 'bcv_api'));

CREATE TABLE exchange_rate_sync (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at  TIMESTAMPTZ,
  last_status      VARCHAR(10) NOT NULL CHECK (last_status IN ('ok', 'error')),
  last_error       VARCHAR(500),
  last_source      VARCHAR(20) CHECK (last_source IS NULL OR last_source IN ('bcv', 'bcv_api')),
  last_rate        NUMERIC(20,8),
  last_rate_date   DATE,
  last_trigger     VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (last_trigger IN ('auto', 'manual'))
);

ALTER TABLE exchange_rate_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchange_rate_sync USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
