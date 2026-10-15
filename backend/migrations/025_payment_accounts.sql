-- =====================================================================
-- 025 · Datos de pago del colegio (pago móvil y cuentas bancarias)
--
--   payment_accounts   dónde recibe pagos el colegio. Puede haber varias
--                      (p. ej. pago móvil en dos bancos). Se muestran al
--                      representante al reportar un pago, según el método:
--     method           mobile_payment (pago móvil) | transfer (transferencia
--                      o depósito a una cuenta)
--     bank_code        código del banco (4 dígitos, ej. 0102); opcional
--     bank_name        nombre del banco
--     holder_name      titular (razón social o nombre); opcional
--     holder_id        cédula o RIF del titular (ej. J-12345678-9)
--     phone            teléfono afiliado      (obligatorio en pago móvil)
--     account_number   número de cuenta       (obligatorio en transferencia)
--     account_type     checking (corriente) | savings (ahorros) (transferencia)
--     notes            indicación adicional (ej. "Indica la cédula del alumno")
--     is_active        visible para los representantes
--
-- Se configuran en Configuración → Datos de pago (permiso tenant_settings).
-- =====================================================================

CREATE TABLE payment_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method          VARCHAR(20) NOT NULL CHECK (method IN ('mobile_payment', 'transfer')),
  bank_code       VARCHAR(4) CHECK (bank_code IS NULL OR bank_code ~ '^[0-9]{4}$'),
  bank_name       VARCHAR(80) NOT NULL CHECK (length(trim(bank_name)) > 0),
  holder_name     VARCHAR(120),
  holder_id       VARCHAR(20) NOT NULL CHECK (length(trim(holder_id)) > 0),
  phone           VARCHAR(20),
  account_number  VARCHAR(30),
  account_type    VARCHAR(10) CHECK (account_type IS NULL OR account_type IN ('checking', 'savings')),
  notes           VARCHAR(200),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_accounts_mobile_fields CHECK (method <> 'mobile_payment' OR phone IS NOT NULL),
  CONSTRAINT payment_accounts_transfer_fields CHECK (method <> 'transfer' OR (account_number IS NOT NULL AND account_type IS NOT NULL))
);

CREATE INDEX idx_payment_accounts_tenant ON payment_accounts(tenant_id, method, sort_order);

ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_accounts USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
