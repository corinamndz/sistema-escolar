-- =====================================================================
-- 072 — Mensualidad de agosto
--
-- Las mensualidades regulares cubren los meses del año escolar (septiembre a
-- julio); agosto NUNCA se genera como mes regular. Se cobra aparte, junto con
-- la mensualidad regular que la administración indique por año escolar:
--
-- school_periods.august_charge_month
--     primer día del mes regular con el que se cobra agosto (ej. 2027-07-01 =
--     «se cobra con Julio 2027»). NULL = sin configurar: agosto no se genera
--     y el panel de Tarifas lo advierte.
--
-- La mensualidad de agosto es un pago propio (billing_month = agosto del año
-- en que termina el año escolar), con la emisión y el vencimiento del mes
-- elegido: en el portal aparece junto a ese mes y tiene su propio recibo.
-- =====================================================================

ALTER TABLE school_periods
  ADD COLUMN IF NOT EXISTS august_charge_month DATE;

ALTER TABLE school_periods DROP CONSTRAINT IF EXISTS ck_school_periods_august_charge_month;
ALTER TABLE school_periods ADD CONSTRAINT ck_school_periods_august_charge_month CHECK (
  august_charge_month IS NULL
  OR (august_charge_month = date_trunc('month', august_charge_month)::date
      AND EXTRACT(MONTH FROM august_charge_month) <> 8)
);
