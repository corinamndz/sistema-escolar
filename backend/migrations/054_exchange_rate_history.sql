-- =====================================================================
-- 054 · Historial de cambios de las tasas de cambio
--
-- exchange_rates guarda UNA tasa por fecha valor: corregir la del día la
-- sobrescribe y borrarla no deja rastro. exchange_rate_history registra cada
-- cambio (alta, corrección del valor, eliminación) con quién y cuándo.
--
-- Se llena con un trigger sobre exchange_rates, así queda auditado todo lo
-- que escribe en la tabla (tasa manual, sincronización con el BCV, borrado de
-- una tasa o de la moneda) sin depender de cada servicio.
--   - Una actualización con el MISMO valor (la sincronización con el BCV corre
--     varias veces al día) no se registra.
--   - Quién: app.user_id (lo fija tenant.middleware en cada petición); sin
--     usuario (sincronización automática) queda NULL = "Sistema".
-- =====================================================================

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency   VARCHAR(10) NOT NULL,
  quote_currency  VARCHAR(10) NOT NULL,
  rate_date       DATE NOT NULL,                 -- fecha valor (desde cuándo rige)
  action          VARCHAR(10) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  rate            NUMERIC(20,8) NOT NULL,        -- valor nuevo (en 'deleted', el que se eliminó)
  previous_rate   NUMERIC(20,8),                 -- solo en 'updated'
  source          VARCHAR(20) NOT NULL,          -- manual | bcv | bcv_api
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  -- clock_timestamp(), no now(): varios cambios en una misma transacción
  -- (ej. la sincronización borra y guarda) deben quedar en su orden real.
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_exchange_rate_history_lookup
  ON exchange_rate_history (tenant_id, quote_currency, changed_at DESC);

ALTER TABLE exchange_rate_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exchange_rate_history;
CREATE POLICY tenant_isolation ON exchange_rate_history
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION fn_exchange_rate_history() RETURNS TRIGGER AS $$
DECLARE
  actor UUID := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO exchange_rate_history (tenant_id, base_currency, quote_currency, rate_date, action, rate, source, changed_by)
    VALUES (NEW.tenant_id, NEW.base_currency, NEW.quote_currency, NEW.rate_date, 'created', NEW.rate, NEW.source, coalesce(actor, NEW.created_by));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.rate IS DISTINCT FROM OLD.rate OR NEW.rate_date IS DISTINCT FROM OLD.rate_date THEN
      INSERT INTO exchange_rate_history (tenant_id, base_currency, quote_currency, rate_date, action, rate, previous_rate, source, changed_by)
      VALUES (NEW.tenant_id, NEW.base_currency, NEW.quote_currency, NEW.rate_date, 'updated', NEW.rate, OLD.rate, NEW.source, coalesce(actor, NEW.created_by));
    END IF;
    RETURN NEW;
  ELSE
    INSERT INTO exchange_rate_history (tenant_id, base_currency, quote_currency, rate_date, action, rate, source, changed_by)
    VALUES (OLD.tenant_id, OLD.base_currency, OLD.quote_currency, OLD.rate_date, 'deleted', OLD.rate, OLD.source, actor);
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exchange_rate_history ON exchange_rates;
CREATE TRIGGER trg_exchange_rate_history
  AFTER INSERT OR UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION fn_exchange_rate_history();

-- Punto de partida: las tasas que ya existen (su valor actual; los cambios
-- anteriores a esta migración no se conocen).
INSERT INTO exchange_rate_history (tenant_id, base_currency, quote_currency, rate_date, action, rate, source, changed_by, changed_at)
SELECT er.tenant_id, er.base_currency, er.quote_currency, er.rate_date, 'created', er.rate, er.source, er.created_by, er.updated_at
FROM exchange_rates er
WHERE er.tenant_id IN (SELECT migration_tenant_ids())
  AND NOT EXISTS (SELECT 1 FROM exchange_rate_history h WHERE h.tenant_id = er.tenant_id);
