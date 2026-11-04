-- =====================================================================
-- 073 — Concepto de pago más largo
--
-- La mensualidad de agosto (migración 072) se describe con el mes con que se
-- cobra: "Mensualidad Agosto 2027 · se cobra con Septiembre 2026" (52
-- caracteres), que no cabía en VARCHAR(30). Ampliar un VARCHAR no reescribe
-- la tabla.
-- =====================================================================

ALTER TABLE payments ALTER COLUMN period_label TYPE VARCHAR(80);
