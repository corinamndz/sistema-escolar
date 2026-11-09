-- =====================================================================
-- 088 · Retiro de alumnos
--
-- `students.status` y `enrollments.status` ya admitían 'withdrawn'. Faltaba:
--
--   student_withdrawals   constancia de cada retiro: fecha, motivo, quién lo
--                         registró y qué matrículas cerró. Un alumno que vuelve
--                         y se retira otra vez conserva ambos registros.
--   trg_students_no_delete  un alumno no se borra nunca: el retiro es lógico y
--                         su histórico (planillas, notas, boletas) se conserva.
--
-- El borrado de un colegio completo sigue funcionando: llega por la cascada de
-- tenants y por eso tiene mayor profundidad de disparadores (pg_trigger_depth).
--
-- La lógica está en students/studentWithdrawal.service.js.
-- =====================================================================

CREATE TABLE IF NOT EXISTS student_withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  withdrawn_on    DATE,            -- NULL solo en retiros anteriores a esta migración: la fecha no se registró
  reason          VARCHAR(500),
  recorded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  enrollment_ids  UUID[] NOT NULL DEFAULT '{}',  -- matrículas que cerró (las que se restauran al reactivar)
  reactivated_at  TIMESTAMPTZ,
  reactivated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo retiro vigente por alumno.
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_withdrawals_open ON student_withdrawals (student_id) WHERE reactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_withdrawals_tenant ON student_withdrawals (tenant_id, student_id);

ALTER TABLE student_withdrawals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_withdrawals;
CREATE POLICY tenant_isolation ON student_withdrawals USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Alumnos que ya estaban retirados: antes el retiro no tocaba su matrícula, así
-- que seguían en listas y cobros. Se cierra igual que un retiro nuevo.
INSERT INTO student_withdrawals (tenant_id, student_id, enrollment_ids)
SELECT s.tenant_id, s.id,
       COALESCE((SELECT array_agg(e.id) FROM enrollments e WHERE e.student_id = s.id AND e.status = 'active'), '{}')
FROM students s
WHERE s.status = 'withdrawn'
  AND NOT EXISTS (SELECT 1 FROM student_withdrawals w WHERE w.student_id = s.id AND w.reactivated_at IS NULL);

UPDATE payments p
SET status = 'cancelled', cancelled_at = now()
FROM enrollments e, students s
WHERE p.enrollment_id = e.id AND e.student_id = s.id
  AND s.status = 'withdrawn' AND e.status = 'active'
  AND p.kind = 'tuition' AND p.status = 'pending'
  AND p.billing_month > date_trunc('month', current_date);

UPDATE enrollments e
SET status = 'withdrawn'
FROM students s
WHERE e.student_id = s.id AND s.status = 'withdrawn' AND e.status = 'active';

-- Un alumno no se borra: se retira.
CREATE OR REPLACE FUNCTION fn_students_no_delete() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD; -- cascada: se está eliminando el colegio completo
  END IF;
  RAISE EXCEPTION 'Un alumno no se puede eliminar: retíralo para conservar su histórico.';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_students_no_delete ON students;
CREATE TRIGGER trg_students_no_delete BEFORE DELETE ON students FOR EACH ROW EXECUTE FUNCTION fn_students_no_delete();
