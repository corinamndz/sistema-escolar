import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import eventsApi from '../../../api/endpoints/events.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import EventBoard from '../components/EventBoard';
import EventDetailModal from '../components/EventDetailModal';
import EventFormModal from '../components/EventFormModal';

/**
 * Cartelera de eventos especiales (administración): actos culturales,
 * eventos familiares, asambleas, reuniones… con una o varias fechas y su
 * horario, dirigidos a todo el colegio, a un grado o a una sección. Lo
 * publicado se ve en el portal del representante.
 */
function EventsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: events, loading, error, refetch } = useFetch(() => eventsApi.list(), []);
  const [editing, setEditing] = useState(null); // {} nuevo | evento
  const [viewing, setViewing] = useState(null); // evento abierto en el detalle

  const upcoming = (events || []).filter((e) => !e.is_past);
  const drafts = (events || []).filter((e) => !e.is_published).length;

  const remove = async (ev) => {
    const ok = await confirm({
      title: `¿Eliminar "${ev.title}"?`,
      message: 'Dejará de verse en la cartelera y en el portal de representantes.',
      danger: true,
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    try {
      await eventsApi.remove(ev.id);
      toast.success('Evento eliminado', ev.title);
      setViewing(null);
      refetch();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  const newButton = can('events', 'create') && (
    <Button icon="plus" onClick={() => setEditing({})}>
      Nuevo evento
    </Button>
  );

  return (
    <div>
      <PageHeader title="Eventos y cartelera" subtitle="Actos culturales, eventos familiares, asambleas y reuniones que verán las familias en el portal" actions={newButton} />

      {events?.length > 0 && (
        <div className="card evt-summary">
          <span>
            <strong>{upcoming.length}</strong> evento{upcoming.length === 1 ? '' : 's'} próximo{upcoming.length === 1 ? '' : 's'}
          </span>
          {upcoming[0] && (
            <span className="text-muted">
              Siguiente: <button type="button" className="link-button" onClick={() => setViewing(upcoming[0])}>{upcoming[0].title}</button>
            </span>
          )}
          {drafts > 0 && (
            <span className="chip">
              {drafts} borrador{drafts === 1 ? '' : 'es'} sin publicar
            </span>
          )}
        </div>
      )}

      <Alert>{error}</Alert>
      {loading ? (
        <Spinner />
      ) : (
        <EventBoard
          events={events || []}
          onSelect={setViewing}
          onEdit={can('events', 'update') ? setEditing : undefined}
          onDelete={can('events', 'delete') ? remove : undefined}
          empty={
            <div className="card empty-state">
              <div className="empty-state__icon">
                <Icon name="calendar" size={24} />
              </div>
              <div className="empty-state__title">Aún no hay eventos</div>
              <div className="text-sm">Publica el primero: un acto cultural, una asamblea de padres, el día de la familia…</div>
              {newButton && <div style={{ marginTop: 12 }}>{newButton}</div>}
            </div>
          }
        />
      )}

      {viewing && (
        <EventDetailModal
          event={viewing}
          onClose={() => setViewing(null)}
          onEdit={
            can('events', 'update')
              ? () => {
                  setEditing(viewing);
                  setViewing(null);
                }
              : undefined
          }
          onDelete={can('events', 'delete') ? () => remove(viewing) : undefined}
          onManageAppointment={can('appointments', 'read') ? () => navigate('/appointments') : undefined}
        />
      )}
      {editing && <EventFormModal initial={editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />}
    </div>
  );
}

export default EventsPage;
