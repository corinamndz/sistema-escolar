-- Indica que el usuario debe cambiar su contraseña antes de usar el sistema.
-- Se activa automáticamente cuando el admin crea o resetea el acceso con
-- contraseña temporal; se desactiva cuando el usuario cambia su contraseña.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.must_change_password IS
  'TRUE cuando la cuenta fue creada o reseteada con contraseña temporal y '
  'el usuario aún no ha cambiado su contraseña.';
