-- =====================================================================
-- 085 · Cierre manual de lapsos
--
-- El Administrador cierra un lapso desde Resumen de calificaciones, sin depender
-- de su fecha de fin. Un lapso cuenta como cerrado si tiene closed_at o si su
-- fecha de fin ya pasó (grading/gradeAdjustments.service.js → termEnded).
--
-- Efecto: permite el ajuste directivo de definitivas (migración 084) en sus
-- materias. No bloquea la carga de notas de los docentes.
-- =====================================================================

ALTER TABLE terms ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE terms ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
