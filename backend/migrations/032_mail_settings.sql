-- =====================================================================
-- 032 · Correo del colegio (SMTP propio: Gmail o servidor corporativo)
--
--   tenant_mail_settings   un registro por colegio
--     host / port          servidor SMTP (smtp.gmail.com : 465 | 587)
--     secure               true = TLS directo (465); false = STARTTLS (587)
--     username             correo con que se inicia sesión (y remitente)
--     from_name            nombre que verán las familias ("Colegio San José")
--     password_enc         contraseña de aplicación CIFRADA (AES-256-GCM);
--                          nunca se devuelve a la interfaz
--     enabled              envíos automáticos activados (comprobantes, avisos…)
--     last_test_*          resultado del último "Enviar correo de prueba"
--
-- Si un colegio no tiene registro, el sistema usa el SMTP global del
-- servidor (variables SMTP_* del .env), como antes de esta migración.
-- =====================================================================

CREATE TABLE tenant_mail_settings (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  host             VARCHAR(255) NOT NULL,
  port             INT NOT NULL CHECK (port BETWEEN 1 AND 65535),
  secure           BOOLEAN NOT NULL DEFAULT true,
  username         VARCHAR(255) NOT NULL,
  from_name        VARCHAR(120),
  password_enc     TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT false,
  last_test_at     TIMESTAMPTZ,
  last_test_ok     BOOLEAN,
  last_test_error  VARCHAR(500),
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_mail_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_mail_settings USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
