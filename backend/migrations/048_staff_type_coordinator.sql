-- =====================================================================
-- 048 · "Coordinador" como tipo de personal
--
-- staff.staff_type admite 'coordinator' (además de teaching, administrative
-- y support). Todo coordinador tiene su etapa (staff.coordination_level,
-- migración 047): initial | primary | secondary.
-- Jerarquía: Director (Administrador) > Coordinador > Docente. El permiso lo
-- da el rol Coordinador de su usuario de acceso; el tipo de personal y la etapa
-- quedan en la ficha desde el alta.
-- =====================================================================

DO $$
DECLARE c TEXT;
BEGIN
  -- El CHECK de 001 no tiene nombre explícito: se busca por su definición.
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'staff'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%staff_type%'
  LOOP
    EXECUTE format('ALTER TABLE staff DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE staff ADD CONSTRAINT staff_staff_type_check
  CHECK (staff_type IN ('administrative', 'teaching', 'support', 'coordinator'));

-- Un coordinador siempre tiene etapa.
ALTER TABLE staff ADD CONSTRAINT staff_coordinator_level_check
  CHECK (staff_type <> 'coordinator' OR coordination_level IS NOT NULL);
