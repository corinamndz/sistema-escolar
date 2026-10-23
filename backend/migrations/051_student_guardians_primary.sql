-- =====================================================================
-- 051 · Representantes ↔ alumnos (N:M): un solo representante principal
--
-- La relación muchos a muchos ya existe desde 001: student_guardians
-- (student_id, guardian_id, relationship, is_primary), con FKs a students y
-- guardians en cascada. Un representante puede tener varios alumnos y un
-- alumno varios representantes (padre, madre, tutor legal…).
--
-- Lo que faltaba: garantizar en la base que cada alumno tenga a lo sumo UN
-- representante principal (el servicio ya lo intentaba, pero la asociación
-- múltiple desde los formularios lo hace más fácil de romper).
-- Corre en public y en cada esquema de colegio (la tabla se resuelve por search_path).
-- =====================================================================

-- Si algún alumno quedó con varios principales, se conserva uno (determinista).
WITH ranked AS (
  SELECT student_id, guardian_id,
         row_number() OVER (PARTITION BY student_id ORDER BY guardian_id) AS rn
  FROM student_guardians
  WHERE is_primary
)
UPDATE student_guardians sg
SET is_primary = false
FROM ranked r
WHERE sg.student_id = r.student_id AND sg.guardian_id = r.guardian_id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_guardians_primary
  ON student_guardians (student_id) WHERE is_primary;
