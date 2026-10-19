-- =====================================================================
-- 046 · Disponibilidad del docente por nivel educativo
--
--   staff.level_availability   en qué nivel puede trabajar el docente:
--                               initial | primary | secondary | all
--
-- Los selectores de "Secciones y personal docente" solo ofrecen a los
-- docentes disponibles para el nivel de la sección, y el servicio rechaza
-- una asignación fuera de su nivel. Por defecto 'all': el personal ya
-- registrado sigue disponible en todos los niveles hasta que se ajuste.
-- =====================================================================

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS level_availability VARCHAR(10) NOT NULL DEFAULT 'all'
  CHECK (level_availability IN ('initial', 'primary', 'secondary', 'all'));

COMMENT ON COLUMN staff.level_availability IS
  'Nivel en que puede trabajar el docente: initial, primary, secondary o all (todos).';
