import { useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { CurriculumModal } from '../components/GradesTab';
import { LevelBadge } from '../levels';

/**
 * Grados de Primaria y Secundaria con el estado de su plan de estudios, para
 * armarlos en el mismo paso donde se crean las materias (antes estaba
 * escondido como acción de fila en la tabla de Grados).
 */
function CurriculumChecklist({ onChanged }) {
  const { can } = useAuth();
  const { data: allGrades, loading, error, refetch } = useFetch(() => academicsApi.listGrades(), []);
  const grades = (allGrades || []).filter((g) => g.has_curriculum);
  const [editing, setEditing] = useState(null);

  if (loading) return <Spinner />;

  return (
    <div className="card">
      <h3 className="card__title">Planes de estudio</h3>
      <p className="card__subtitle">Elige qué materias ve cada grado de Primaria y Secundaria. En Primaria las dicta el titular (o un especialista); en Secundaria, un profesor por materia.</p>
      <Alert>{error}</Alert>

      {grades.length === 0 ? (
        <p className="text-muted text-sm">No hay grados de Primaria ni Secundaria. Si el colegio solo ofrece Inicial, este paso no aplica.</p>
      ) : (
        <ul className="curriculum-checklist">
          {grades.map((g) => (
            <li key={g.id} className={g.subject_count ? 'is-done' : ''}>
              <span className="curriculum-checklist__status">
                <Icon name={g.subject_count ? 'checkCircle' : 'alertCircle'} size={17} />
              </span>
              <span className="curriculum-checklist__name">
                <span>
                  {g.name} <LevelBadge code={g.level_code} />
                </span>
                <span className="cell-person__sub">
                  {g.subject_count ? `${g.subject_count} materia${g.subject_count === 1 ? '' : 's'}` : 'Sin materias asignadas'}
                </span>
              </span>
              <Button size="sm" variant={g.subject_count ? 'ghost' : 'primary'} onClick={() => setEditing(g)}>
                {g.subject_count ? 'Ver / editar' : 'Armar plan'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CurriculumModal
          grade={editing}
          canEdit={can('academics', 'update')}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refetch();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

export default CurriculumChecklist;
