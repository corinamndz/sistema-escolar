-- =====================================================================
-- 035 · Se retira la integración con WhatsApp
--
-- La 034 creó la configuración de WhatsApp por colegio, la cola de envíos y
-- la exclusión por representante. La funcionalidad se quitó del sistema (aún
-- no hay cuenta de WhatsApp Business): los avisos salen solo por la campana y
-- por correo. Se eliminan sus tablas y la columna; la 034 se conserva tal
-- cual porque ya está aplicada en bases existentes.
-- =====================================================================

DROP TABLE IF EXISTS whatsapp_messages;
DROP TABLE IF EXISTS tenant_whatsapp_settings;
ALTER TABLE guardians DROP COLUMN IF EXISTS whatsapp_opt_out;
