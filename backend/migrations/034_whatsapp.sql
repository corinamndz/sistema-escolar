-- =====================================================================
-- 034 · WhatsApp del colegio: configuración, cola de envíos y exclusión
--
--   tenant_whatsapp_settings   un registro por colegio
--     provider          meta (WhatsApp Cloud API) | twilio | evolution (pasarela)
--     phone_number      número de WhatsApp del colegio (+58 412…), para mostrar
--     default_country   código de país para los teléfonos sin él (58 = Venezuela)
--     config            parámetros del proveedor (sin secretos): phone_number_id,
--                       versión de la API, account SID, URL de la pasarela,
--                       instancia, plantilla y su idioma…
--     secret_enc        token / auth token / API key CIFRADO (AES-256-GCM)
--     use_template      enviar los avisos con una plantilla aprobada (necesario
--                       en Meta y Twilio para iniciar conversación)
--     events            qué avisos se envían por WhatsApp
--     consent_confirmed el colegio declara tener el consentimiento de las familias
--     enabled           envíos automáticos activados
--
--   whatsapp_messages         cola (outbox): cada aviso a cada representante.
--                             Se escribe en la misma transacción que el evento
--                             y lo envía la tarea en segundo plano, con reintentos.
--     dedupe_key        evita enviar dos veces el mismo aviso al mismo número
--
--   guardians.whatsapp_opt_out  el representante no quiere recibir WhatsApp
-- =====================================================================

CREATE TABLE tenant_whatsapp_settings (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider           VARCHAR(20) NOT NULL CHECK (provider IN ('meta', 'twilio', 'evolution')),
  phone_number       VARCHAR(20) NOT NULL,
  default_country    VARCHAR(4) NOT NULL DEFAULT '58' CHECK (default_country ~ '^[0-9]{1,4}$'),
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_enc         TEXT NOT NULL,
  use_template       BOOLEAN NOT NULL DEFAULT true,
  events             JSONB NOT NULL DEFAULT '{"bcv_rate": true, "heavy_evaluation": true, "school_event": true, "payment_reported": true, "payment_confirmed": true}'::jsonb,
  consent_confirmed  BOOLEAN NOT NULL DEFAULT false,
  enabled            BOOLEAN NOT NULL DEFAULT false,
  last_test_at       TIMESTAMPTZ,
  last_test_ok       BOOLEAN,
  last_test_error    VARCHAR(500),
  updated_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_whatsapp_enabled_consent CHECK (NOT enabled OR consent_confirmed)
);

CREATE TABLE whatsapp_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  guardian_id          UUID REFERENCES guardians(id) ON DELETE SET NULL,
  to_phone             VARCHAR(20) NOT NULL,              -- solo dígitos, con código de país
  event_type           VARCHAR(30) NOT NULL,
  body                 VARCHAR(1500) NOT NULL,
  status               VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts             INT NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at           TIMESTAMPTZ,
  provider             VARCHAR(20),
  provider_message_id  VARCHAR(200),
  error                VARCHAR(500),
  dedupe_key           VARCHAR(200),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at              TIMESTAMPTZ,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX idx_whatsapp_messages_queue ON whatsapp_messages (tenant_id, status, next_attempt_at);
CREATE INDEX idx_whatsapp_messages_recent ON whatsapp_messages (tenant_id, created_at DESC);

ALTER TABLE guardians ADD COLUMN whatsapp_opt_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tenant_whatsapp_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_whatsapp_settings USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_messages USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
