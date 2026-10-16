-- =====================================================================
-- 027 · Clubes: fechas de sesión (reemplaza el horario en texto libre)
--
--   club_sessions   cada día concreto en que se reúne el club
--     session_date  la fecha (única por club)
--   clubs.start_time / end_time
--                   hora común de las sesiones (opcional), p. ej. 14:00–15:30
--
-- clubs.schedule_text se conserva solo como dato heredado (los clubes
-- creados antes de esta migración): el formulario ya no lo edita.
-- =====================================================================

ALTER TABLE clubs
  ADD COLUMN start_time TIME,
  ADD COLUMN end_time   TIME,
  ADD CONSTRAINT ck_clubs_time_range CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time);

CREATE TABLE club_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  club_id       UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  session_date  DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, session_date)
);
CREATE INDEX idx_club_sessions_club ON club_sessions (tenant_id, club_id, session_date);

ALTER TABLE club_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON club_sessions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
