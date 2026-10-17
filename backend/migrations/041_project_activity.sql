-- Proyecto pedagógico de aula integrado al plan de evaluación.
--
-- El proyecto pasa a ser una actividad más del plan (categoría 'project') con
-- su ponderación: suma al 100% del lapso, se califica en activity_scores y
-- cuenta en el acumulado y la nota definitiva como cualquier otra actividad.
-- Las competencias siguen siendo su evaluación cualitativa.
--
-- Los proyectos ya existentes quedan sin actividad (evaluation_activity_id
-- NULL) hasta que el docente les asigne una ponderación desde el plan.

ALTER TABLE pedagogical_projects
  ADD COLUMN IF NOT EXISTS evaluation_activity_id UUID UNIQUE REFERENCES evaluation_activities(id) ON DELETE CASCADE;

COMMENT ON COLUMN pedagogical_projects.evaluation_activity_id IS
  'Actividad del plan que pondera y califica el proyecto (categoría project). '
  'Al eliminar la actividad se elimina el proyecto con sus competencias.';
