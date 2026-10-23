-- =====================================================================
-- 052 · Citas con padres: confirmación del representante y reenvío del aviso
--
-- El estado ya existe (042): toda cita nace 'pending' (= pendiente de
-- confirmación) y pasa a 'confirmed' cuando el representante la confirma
-- desde el portal (o la administración la marca). last_notified_at ya guarda
-- el último aviso; ahora se reenvía a pedido ("Reenviar aviso").
--
--   confirmed_at   cuándo se confirmó
--   confirmed_by   quién (el usuario del portal del representante, o personal)
--   reminder_count avisos reenviados a mano (además del aviso al agendar)
-- Corre en public y en cada esquema de colegio.
-- =====================================================================

ALTER TABLE citas_padres ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE citas_padres ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE citas_padres ADD COLUMN IF NOT EXISTS reminder_count INT NOT NULL DEFAULT 0 CHECK (reminder_count >= 0);

-- Las ya confirmadas antes de esta migración: se toma su última modificación.
UPDATE citas_padres SET confirmed_at = updated_at WHERE status = 'confirmed' AND confirmed_at IS NULL;

-- Panel del representante: sus citas próximas.
CREATE INDEX IF NOT EXISTS idx_citas_padres_guardian_date ON citas_padres (guardian_id, meeting_date);
