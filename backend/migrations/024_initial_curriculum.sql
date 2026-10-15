-- =====================================================================
-- 024 · Inicial también puede tener plan de estudios (áreas / materias)
--
-- Hasta ahora Inicial no tenía plan de estudios (has_curriculum = false): sus
-- grados no podían tener materias y el plan de evaluación se creaba con el
-- área escrita a mano. Ahora cualquier nivel puede tener materias o áreas
-- marcadas por grado (Configuración de la materia → "Grados donde se dicta"),
-- y el plan de evaluación se crea eligiéndolas de una lista.
--
-- Es OPCIONAL en Inicial: un grado sin materias sigue funcionando como antes
-- (el plan se crea con el docente de aula y un área del catálogo). La forma
-- de asignar docentes no cambia: titular (+ auxiliar), que dicta todas las
-- áreas del grado salvo las que tengan un especialista.
-- =====================================================================

UPDATE education_levels SET has_curriculum = true WHERE code = 'initial';
