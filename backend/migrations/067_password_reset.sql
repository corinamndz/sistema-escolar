-- =====================================================================
-- 067 · Recuperación de contraseña ("¿Olvidaste tu contraseña?")
--
-- users.reset_token_hash      SHA-256 (hex) del token enviado por correo.
--   El token en claro SOLO viaja en el enlace: si la base se filtra, los
--   hashes no sirven para restablecer cuentas (igual que una contraseña).
-- users.reset_token_expires   vencimiento del enlace (30 min por defecto,
--   PASSWORD_RESET_TTL_MINUTES). Al usarlo, ambas columnas vuelven a NULL:
--   cada enlace sirve UNA sola vez y pedir otro invalida el anterior.
-- users.reset_requested_at    última solicitud: limita el reenvío del correo
--   (no se manda más de uno por minuto a la misma cuenta).
--
-- mail_log.kind admite 'password_reset' (bitácora de correos enviados).
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token_hash    CHAR(64),
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reset_requested_at  TIMESTAMPTZ;

-- Búsqueda por token al restablecer (solo filas con un enlace pendiente).
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_reset_token
  ON users (reset_token_hash) WHERE reset_token_hash IS NOT NULL;

COMMENT ON COLUMN users.reset_token_hash IS
  'SHA-256 del token de recuperación de contraseña (el token en claro nunca se guarda).';
COMMENT ON COLUMN users.reset_token_expires IS
  'Vencimiento del enlace de recuperación; NULL si no hay uno pendiente.';

ALTER TABLE mail_log DROP CONSTRAINT IF EXISTS mail_log_kind_check;
ALTER TABLE mail_log ADD CONSTRAINT mail_log_kind_check
  CHECK (kind IN ('credentials', 'payment_receipt', 'password_reset'));
