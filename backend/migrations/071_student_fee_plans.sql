-- =====================================================================
-- 071 — Tarifas especiales por alumno (becas, convenios, descuentos)
--
-- fee_plans       catálogo de tarifas especiales del colegio:
--                   'percentage'  descuento sobre la tarifa del nivel
--                                 (Beca 50 % → 50; Beca total → 100)
--                   'fixed'       monto mensual fijo en USD (Convenio empresa: 80)
-- students        + fee_plan_id: tarifa especial asignada.
--                   NULL = tarifa general de su nivel (valor por defecto).
--                   No se copia el id de la tarifa del nivel porque esas tarifas
--                   son POR AÑO ESCOLAR: con NULL, el alumno sigue
--                   automáticamente la tarifa de su nivel en cada año.
-- payments        + base_amount / fee_plan_id: con qué tarifa del nivel y qué
--                   tarifa especial se calculó cada mensualidad (trazabilidad).
--                 + cancel_reason: 'fee_plan' marca las mensualidades anuladas
--                   por una beca total, para reactivarlas si se le quita.
-- =====================================================================

CREATE TABLE IF NOT EXISTS fee_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(80) NOT NULL,
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('percentage', 'fixed')),
  percentage   NUMERIC(5,2),
  amount       NUMERIC(10,2),
  currency     VARCHAR(10) NOT NULL DEFAULT 'USD',
  description  VARCHAR(300),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fee_plans_value CHECK (
    (kind = 'percentage' AND percentage > 0 AND percentage <= 100 AND amount IS NULL)
    OR (kind = 'fixed' AND amount > 0 AND percentage IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_plans_name ON fee_plans (tenant_id, lower(name));

ALTER TABLE fee_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_plans;
CREATE POLICY tenant_isolation ON fee_plans
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Alumno: tarifa especial (opcional). RESTRICT: no se borra una tarifa en uso.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS fee_plan_id          UUID REFERENCES fee_plans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fee_plan_note        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS fee_plan_assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_students_fee_plan ON students (fee_plan_id) WHERE fee_plan_id IS NOT NULL;

-- Mensualidades: con qué se calcularon.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS base_amount   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS fee_plan_id   UUID REFERENCES fee_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(20);
