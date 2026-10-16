-- =====================================================================
-- 029 · Cartelera: una sola fecha por evento
--
-- La 028 creó los eventos con VARIAS fechas (tabla school_event_dates).
-- Ahora cada evento tiene UNA fecha con su hora de inicio y (opcional) de
-- fin, guardadas en el propio evento:
--
--   school_events.event_date   la fecha
--   school_events.start_time   hora de inicio (obligatoria)
--   school_events.end_time     hora de fin (opcional, posterior al inicio)
--
-- Conversión de los datos existentes (nada se pierde):
--   - la primera fecha de cada evento pasa al propio evento;
--   - cada fecha adicional se convierte en un evento propio (copia del
--     original con esa fecha y su horario);
--   - una fecha sin hora ("todo el día") queda a las 08:00;
--   - un evento sin ninguna fecha queda como BORRADOR con la fecha en que
--     se creó, para que la administración lo revise.
-- =====================================================================

ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS event_date DATE,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;

-- Fechas adicionales → eventos propios.
INSERT INTO school_events (tenant_id, title, category, description, location, audience, grade_id, section_id,
                           is_published, created_by, created_at, updated_at, event_date, start_time, end_time)
SELECT e.tenant_id, e.title, e.category, e.description, e.location, e.audience, e.grade_id, e.section_id,
       e.is_published, e.created_by, e.created_at, now(), d.event_date, COALESCE(d.start_time, '08:00'), d.end_time
FROM (
  SELECT d.*, row_number() OVER (PARTITION BY d.event_id ORDER BY d.event_date) AS rn
  FROM school_event_dates d
) d
JOIN school_events e ON e.id = d.event_id
WHERE d.rn > 1;

-- Primera fecha → el propio evento.
UPDATE school_events e
SET event_date = d.event_date,
    start_time = COALESCE(d.start_time, '08:00'),
    end_time   = d.end_time
FROM (
  SELECT DISTINCT ON (event_id) event_id, event_date, start_time, end_time
  FROM school_event_dates
  ORDER BY event_id, event_date
) d
WHERE d.event_id = e.id AND e.event_date IS NULL;

-- Eventos sin fecha: borrador con la fecha de creación.
UPDATE school_events
SET event_date = created_at::date, start_time = '08:00', is_published = false
WHERE event_date IS NULL;

ALTER TABLE school_events
  ALTER COLUMN event_date SET NOT NULL,
  ALTER COLUMN start_time SET NOT NULL;

ALTER TABLE school_events DROP CONSTRAINT IF EXISTS ck_school_events_time;
ALTER TABLE school_events ADD CONSTRAINT ck_school_events_time CHECK (end_time IS NULL OR end_time > start_time);
CREATE INDEX IF NOT EXISTS idx_school_events_date ON school_events (tenant_id, event_date, start_time);

DROP TABLE IF EXISTS school_event_dates;
