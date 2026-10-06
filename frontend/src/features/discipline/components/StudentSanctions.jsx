import { useState } from 'react';
import disciplineApi from '../../../api/endpoints/discipline.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { SanctionCard, SanctionFormModal, SeverityTotals } from './SanctionParts';

/**
 * Convivencia en la ficha del alumno: historial de sanciones con totales por
 * gravedad. La administración registra, edita y elimina; el docente solo
 * consulta (el backend ya limita a los alumnos de su carga).
 */
function StudentSanctions({ studentId }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, refetch } = useFetch(() => disciplineApi.forStudent(studentId), [studentId]);
  const [editing, setEditing] = useState(null); // {} = nueva; sanción = editar

  // El docente solo consulta: la gestión es de la administración (el backend responde 403).
  const manage = (action) => can('discipline', action) && !user?.isRestrictedTeacher;
  const canEdit = () => manage('update');
  const canDelete = () => manage('delete');

  const remove = async (s) => {
    const ok = await confirm({
      title: '¿Eliminar esta sanción?',
      message: `"${s.fault_type}" del ${s.occurred_on}. Se borrará del historial del alumno.`,
      danger: true,
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await disciplineApi.remove(s.id);
      toast.success('Sanción eliminada');
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  return (
    <Card
      title="Convivencia"
      subtitle="Sanciones disciplinarias registradas"
      actions={
        manage('create') && (
          <Button size="sm" icon="plus" onClick={() => setEditing({})}>
            Registrar sanción
          </Button>
        )
      }
    >
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : (
        <>
          <SeverityTotals totals={data.totals} />
          {data.items.length === 0 ? (
            <p className="text-muted">Sin sanciones registradas.</p>
          ) : (
            <div className="sanction-list">
              {data.items.map((s) => (
                <SanctionCard key={s.id} sanction={s} onEdit={canEdit(s) ? setEditing : undefined} onDelete={canDelete(s) ? remove : undefined} />
              ))}
            </div>
          )}
        </>
      )}
      {editing && (
        <SanctionFormModal
          initial={editing.id ? editing : null}
          studentId={studentId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success(editing.id ? 'Sanción actualizada' : 'Sanción registrada');
            refetch();
          }}
        />
      )}
    </Card>
  );
}

export default StudentSanctions;
