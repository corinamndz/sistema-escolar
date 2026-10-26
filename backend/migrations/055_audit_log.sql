-- =====================================================================
-- 055 · Bitácora de auditoría
--
-- audit_logs (creada en 001, casi sin uso) pasa a ser la bitácora de
-- actividad del colegio, consultable solo por el Administrador:
--   action        código legible: CREAR_ALUMNO, ACTUALIZAR_TASA, INICIAR_SESION…
--   module        módulo afectado (students, payments…; ver auditCatalog.js)
--   entity        tabla o recurso; entity_id = registro afectado (si se conoce)
--   summary       detalle en texto legible ("Confirmó el pago Mensualidad Octubre")
--   actor_name / actor_username   quién, tal como se llamaba en ese momento
--                 (el usuario puede borrarse o cambiar de nombre después)
--   ip_address / user_agent       desde dónde
--   request       método, ruta, estado, parámetros y datos enviados (sin
--                 contraseñas ni tokens)
--   diff          cambios o datos adicionales del evento
--
-- Se registra sola desde tenant.middleware (cada petición que modifica datos y
-- termina bien, en la MISMA transacción que el cambio) y con logAudit() para
-- eventos que no pasan por él (inicio de sesión).
-- =====================================================================

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS module          VARCHAR(40),
  ADD COLUMN IF NOT EXISTS summary         VARCHAR(500),
  ADD COLUMN IF NOT EXISTS actor_name      VARCHAR(150),
  ADD COLUMN IF NOT EXISTS actor_username  VARCHAR(150),
  ADD COLUMN IF NOT EXISTS ip_address      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS user_agent      VARCHAR(300),
  ADD COLUMN IF NOT EXISTS request         JSONB;

ALTER TABLE audit_logs ALTER COLUMN action TYPE VARCHAR(60);
-- Hora real de cada evento (now() es igual para todo lo de una misma transacción).
ALTER TABLE audit_logs ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs (tenant_id, module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (tenant_id, user_id, created_at DESC);

-- Registros anteriores (eliminación de monedas, migración 041).
UPDATE audit_logs
SET module = 'payments', action = 'ELIMINAR_MONEDA',
    summary = coalesce(summary, 'Eliminó la moneda ' || coalesce(diff->>'name', '') || ' (' || coalesce(diff->>'currency', '') || ') con sus pagos y tasas')
WHERE entity = 'tenant_currencies' AND action = 'delete';
