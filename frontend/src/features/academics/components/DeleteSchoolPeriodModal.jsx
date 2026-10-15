import { useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';

/** Qué se elimina, en el orden en que importa al usuario (solo lo que tiene datos). */
const IMPACT_ROWS = [
  ['sections', 'secciones', 'sección'],
  ['enrollments', 'inscripciones de alumnos', 'inscripción de alumno'],
  ['evaluation_plans', 'planes de evaluación', 'plan de evaluación'],
  ['activities', 'actividades evaluativas', 'actividad evaluativa'],
  ['scores', 'calificaciones registradas', 'calificación registrada'],
  ['schedule_classes', 'clases del horario', 'clase del horario'],
  ['time_slots', 'bloques horarios', 'bloque horario'],
  ['sanctions', 'sanciones de convivencia', 'sanción de convivencia'],
  ['terms', 'lapsos', 'lapso'],
  ['tuition_fees', 'tarifas de mensualidad', 'tarifa de mensualidad'],
  ['pending_charges', 'cobros pendientes o anulados sin pagar', 'cobro pendiente o anulado sin pagar'],
];

/**
 * Eliminación de un año escolar: advertencia contundente, el detalle de lo
 * que se borrará (contado en el servidor) y confirmación escribiendo el nombre
 * del año. El botón destructivo solo se habilita con el nombre exacto.
 */
function DeleteSchoolPeriodModal({ period, onClose, onDeleted }) {
  const toast = useToast();
  const { data, loading, error } = useFetch(() => academicsApi.getPeriodDeletionImpact(period.id), [period.id]);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const matches = typed.trim().toLowerCase() === period.name.trim().toLowerCase();
  const impact = data?.impact;
  const rows = impact ? IMPACT_ROWS.filter(([key]) => impact[key] > 0) : [];

  const confirm = async (e) => {
    e.preventDefault();
    if (!matches) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await academicsApi.deleteSchoolPeriod(period.id, typed.trim());
      toast.success('Año escolar eliminado', `${period.name} y toda su información asociada.`);
      onDeleted();
      onClose();
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title={`Eliminar el año escolar ${period.name}`} onClose={deleting ? () => {} : onClose}>
      <div className="danger-zone">
        <div className="danger-zone__icon">
          <Icon name="alertTriangle" size={22} />
        </div>
        <div>
          <strong>¿Estás seguro de eliminar este año escolar?</strong>
          <p>
            Esta acción es <strong>irreversible</strong> y eliminará toda la información asociada a este periodo, incluyendo los planes de
            evaluación, calificaciones, horarios y registros vinculados.
          </p>
        </div>
      </div>

      <Alert>{error}</Alert>
      {loading ? (
        <Spinner label="Calculando lo que se eliminará…" />
      ) : impact ? (
        <>
          {data.school_period.is_active && (
            <Alert variant="warning">Es un año escolar ACTIVO: el colegio dejará de tener ese año disponible para inscripciones, notas y pagos.</Alert>
          )}
          {data.is_last && <Alert variant="warning">Es el único año escolar del colegio: después tendrás que crear uno nuevo.</Alert>}

          {rows.length ? (
            <div className="deletion-impact">
              <span className="student-card__label">Se eliminará definitivamente</span>
              <ul>
                {rows.map(([key, many, one]) => (
                  <li key={key}>
                    <strong>{impact[key]}</strong> {impact[key] === 1 ? one : many}
                    {key === 'enrollments' && impact.students > 0 && <span className="text-muted"> ({impact.students} alumnos)</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">Este año no tiene secciones, planes ni otros registros: solo se eliminará el año.</p>
          )}

          <div className="deletion-impact deletion-impact--kept">
            <span className="student-card__label">Se conserva</span>
            <p className="text-sm">
              Los alumnos, representantes, personal, grados y materias del colegio
              {impact.kept_payments > 0 && (
                <>
                  , y <strong>{impact.kept_payments}</strong> pago{impact.kept_payments === 1 ? '' : 's'} ya registrado
                  {impact.kept_payments === 1 ? '' : 's'} (historial financiero), que quedará{impact.kept_payments === 1 ? '' : 'n'} como pago{impact.kept_payments === 1 ? '' : 's'} suelto{impact.kept_payments === 1 ? '' : 's'}, sin año asociado
                </>
              )}
              .
            </p>
          </div>

          <form onSubmit={confirm} className="deletion-confirm">
            <label htmlFor="confirm-period-name">
              Para confirmar, escribe el nombre del año escolar: <strong className="deletion-confirm__name">{period.name}</strong>
            </label>
            <input
              id="confirm-period-name"
              className={`input ${typed && !matches ? 'input--error' : ''}`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={period.name}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={deleting}
            />
            <Alert>{deleteError}</Alert>
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={onClose} disabled={deleting}>
                Cancelar
              </Button>
              <Button type="submit" variant="danger-solid" icon="trash" loading={deleting} loadingText="Eliminando…" disabled={!matches || deleting}>
                Eliminar definitivamente
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </Modal>
  );
}

export default DeleteSchoolPeriodModal;
