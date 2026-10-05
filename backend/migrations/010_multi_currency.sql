-- =====================================================================
-- 010 — Multimoneda: tasas de varias monedas latinoamericanas contra el USD
--
-- Antes (007) todo giraba en torno a USD → VES (tasa BCV) y cada pago
-- confirmado guardaba `amount_ves`. Ahora:
--
--   currencies          catálogo global de monedas (código ISO 4217, símbolo,
--                       decimales, formato). USD es la moneda base.
--   tenant_currencies   monedas de referencia que usa cada colegio y cuál es la
--                       predeterminada (con la que se muestran los montos si el
--                       usuario no elige otra). USD siempre está disponible.
--   exchange_rates      sin cambios de forma: ya guardaba base/quote por fecha
--                       valor. Se agrega la FK de quote_currency al catálogo.
--   payments            amount_ves / exchange_rate / exchange_rate_date se
--                       generalizan a ref_currency / ref_rate / ref_rate_date /
--                       ref_amount: la "foto" de la conversión al CONFIRMAR el
--                       pago, en la moneda que se eligió. Mientras el pago está
--                       pendiente, ref_currency guarda la moneda que eligió la
--                       familia al reportarlo (o NULL = la predeterminada) y el
--                       monto se estima con la tasa vigente.
--
-- La tarifa base sigue en USD: ref_amount = round(amount × tasa, decimales de
-- la moneda), calculado en PostgreSQL con NUMERIC.
-- =====================================================================

CREATE TABLE currencies (
  code             VARCHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name             VARCHAR(60) NOT NULL,
  country          VARCHAR(60),
  symbol           VARCHAR(8) NOT NULL,
  decimals         SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 2),
  locale           VARCHAR(10) NOT NULL DEFAULT 'es',   -- formato de números (Intl)
  official_source  VARCHAR(20),                          -- 'bcv' = se puede consultar automáticamente
  sort_order       INT NOT NULL DEFAULT 100
);

INSERT INTO currencies (code, name, country, symbol, decimals, locale, official_source, sort_order) VALUES
  ('USD', 'Dólar estadounidense', 'Estados Unidos',       '$',    2, 'es-VE', NULL,  0),
  ('VES', 'Bolívar',              'Venezuela',            'Bs.',  2, 'es-VE', 'bcv', 1),
  ('COP', 'Peso colombiano',      'Colombia',             'COL$', 2, 'es-CO', NULL,  2),
  ('PEN', 'Sol',                  'Perú',                 'S/',   2, 'es-PE', NULL,  3),
  ('ARS', 'Peso argentino',       'Argentina',            'AR$',  2, 'es-AR', NULL,  4),
  ('CLP', 'Peso chileno',         'Chile',                'CLP$', 0, 'es-CL', NULL,  5),
  ('MXN', 'Peso mexicano',        'México',               'MX$',  2, 'es-MX', NULL,  6),
  ('BRL', 'Real',                 'Brasil',               'R$',   2, 'pt-BR', NULL,  7),
  ('BOB', 'Boliviano',            'Bolivia',              'Bs',   2, 'es-BO', NULL,  8),
  ('UYU', 'Peso uruguayo',        'Uruguay',              '$U',   2, 'es-UY', NULL,  9),
  ('PYG', 'Guaraní',              'Paraguay',             '₲',    0, 'es-PY', NULL, 10),
  ('DOP', 'Peso dominicano',      'República Dominicana', 'RD$',  2, 'es-DO', NULL, 11),
  ('CRC', 'Colón',                'Costa Rica',           '₡',    2, 'es-CR', NULL, 12),
  ('GTQ', 'Quetzal',              'Guatemala',            'Q',    2, 'es-GT', NULL, 13);

CREATE TABLE tenant_currencies (
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  currency_code  VARCHAR(3) NOT NULL REFERENCES currencies(code),
  is_default     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, currency_code),
  -- El USD es la moneda base: siempre disponible, no se "activa".
  CHECK (currency_code <> 'USD')
);

-- Una sola moneda predeterminada por colegio.
CREATE UNIQUE INDEX ux_tenant_currencies_default ON tenant_currencies (tenant_id) WHERE is_default;

-- Colegios existentes: siguen trabajando en bolívares como hasta ahora.
INSERT INTO tenant_currencies (tenant_id, currency_code, is_default)
SELECT id, 'VES', true FROM tenants;

ALTER TABLE tenant_currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_currencies
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Tasas: siempre "moneda local por 1 USD", de una moneda del catálogo.
ALTER TABLE exchange_rates
  ADD CONSTRAINT fk_exchange_rates_quote FOREIGN KEY (quote_currency) REFERENCES currencies(code),
  ADD CONSTRAINT ck_exchange_rates_usd_base CHECK (base_currency = 'USD' AND quote_currency <> 'USD');

-- ---------------------------------------------------------------------
-- Pagos: conversión genérica
-- ---------------------------------------------------------------------

ALTER TABLE payments
  ADD COLUMN ref_currency   VARCHAR(3) REFERENCES currencies(code),
  ADD COLUMN ref_rate       NUMERIC(20,8) CHECK (ref_rate IS NULL OR ref_rate > 0),
  ADD COLUMN ref_rate_date  DATE,
  ADD COLUMN ref_amount     NUMERIC(18,2) CHECK (ref_amount IS NULL OR ref_amount >= 0);

-- Datos existentes: la conversión congelada era siempre a bolívares.
UPDATE payments
SET ref_currency  = 'VES',
    ref_rate      = exchange_rate,
    ref_rate_date = exchange_rate_date,
    ref_amount    = amount_ves
WHERE amount_ves IS NOT NULL;

ALTER TABLE payments
  DROP COLUMN amount_ves,
  DROP COLUMN exchange_rate,
  DROP COLUMN exchange_rate_date;

-- Coherencia de la foto: si hay monto convertido, hay moneda; si hay tasa, hay fecha valor.
ALTER TABLE payments
  ADD CONSTRAINT ck_payments_ref_amount_currency CHECK (ref_amount IS NULL OR ref_currency IS NOT NULL),
  ADD CONSTRAINT ck_payments_ref_rate_date CHECK ((ref_rate IS NULL) = (ref_rate_date IS NULL));

CREATE INDEX idx_payments_ref_rate ON payments (tenant_id, ref_currency, ref_rate_date) WHERE ref_rate_date IS NOT NULL;
