-- =====================================================================
-- 033 · Correo del colegio con "Conectar con Google" (OAuth2, Gmail API)
--
--   tenant_mail_settings
--     provider               'google' (cuenta de Gmail conectada con OAuth2)
--                            | 'smtp' (servidor y contraseña, migración 032)
--     oauth_refresh_token_enc  token de refresco CIFRADO (AES-256-GCM)
--     oauth_access_token_enc   último token de acceso CIFRADO (dura ~1 h)
--     oauth_token_expires_at   cuándo vence el token de acceso
--     oauth_scope              permisos concedidos (gmail.send)
--     oauth_connected_at       cuándo se conectó la cuenta
--     oauth_error              motivo si Google revocó el acceso
--   Con Google no hay servidor ni puerto: host/port pasan a ser opcionales.
--
--   oauth_states             solicitudes de conexión en curso (10 minutos):
--                            protegen el regreso desde Google (CSRF) y
--                            guardan el verificador PKCE.
-- =====================================================================

ALTER TABLE tenant_mail_settings
  ADD COLUMN provider                 VARCHAR(10) NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp', 'google')),
  ADD COLUMN oauth_refresh_token_enc  TEXT,
  ADD COLUMN oauth_access_token_enc   TEXT,
  ADD COLUMN oauth_token_expires_at   TIMESTAMPTZ,
  ADD COLUMN oauth_scope              TEXT,
  ADD COLUMN oauth_connected_at       TIMESTAMPTZ,
  ADD COLUMN oauth_error              VARCHAR(500),
  ALTER COLUMN host DROP NOT NULL,
  ALTER COLUMN port DROP NOT NULL,
  ADD CONSTRAINT ck_mail_settings_provider CHECK (
    (provider = 'smtp'   AND host IS NOT NULL AND port IS NOT NULL) OR
    (provider = 'google' AND oauth_refresh_token_enc IS NOT NULL)
  );

CREATE TABLE oauth_states (
  state_hash          CHAR(64) PRIMARY KEY,          -- sha256 del parámetro state (el valor no se guarda)
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  provider            VARCHAR(20) NOT NULL DEFAULT 'google',
  code_verifier_enc   TEXT NOT NULL,                 -- PKCE, cifrado
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_states_tenant ON oauth_states (tenant_id, expires_at);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON oauth_states USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
