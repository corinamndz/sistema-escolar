import { useState } from 'react';
import appointmentsApi from '../../../api/endpoints/appointments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import { useLiveRefresh } from '../../../hooks/useLiveRefresh';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { longDate, todayStr } from '../../events/eventCatalog';
import { APPOINTMENT_STATUSES } from '../appointmentCatalog';

const timeLabel = (a) => (a.end_time ? `${a.start_time} – ${a.end_time}` : a.start_time);

/**
 * Portal de padres: citas próximas de la familia con el colegio. Las
 * pendientes muestran "Confirmar asistencia"; al confirmar, la administración
 * lo ve en su listado (y en la campana). Se actualiza sola si el colegio
 * reprograma o cancela.
 */
function MyAppointments() {
  const toast = useToast();
  const { data, setData, loading } = useFetch(() => appointmentsApi.mine().catch(() => []), []);
  useLiveRefresh(() => appointmentsApi.mine().then(setData).catch(() => {}), 30000);
  const [confirming, setConfirming] = useState(null);
  const today = todayStr();

  const list = data || [];
  if (loading || list.length === 0) return null;
  const pending = list.filter((a) => a.status === 'pending').length;

  const confirm = async (a) => {
    setConfirming(a.id);
    try {
      const saved = await appointmentsApi.confirmMine(a.id);
      setData((prev) => (prev || []).map((x) => (x.id === a.id ? saved : x)));
      toast.success('Asistencia confirmada', `${longDate(a.meeting_date)} · ${timeLabel(a)}`);
    } catch (err) {
      toast.error('No se pudo confirmar', getErrorMessage(err));
    } finally {
      setConfirming(null);
    }
  };

  return (
    <section className="card my-appts" aria-label="Citas con el colegio">
      <div className="card__header">
        <div>
          <h3 className="card__title">
            Mis citas con el colegio <span className="data-table__count">{list.length}</span>
          </h3>
          <p className="card__subtitle">
            {pending ? `Tienes ${pending} cita${pending === 1 ? '' : 's'} por confirmar.` : 'Todas tus citas están confirmadas.'}
          </p>
        </div>
      </div>
      <ul className="my-appts__list">
        {list.map((a) => {
          const meta = APPOINTMENT_STATUSES[a.status];
          return (
            <li key={a.id} className={`my-appts__item ${a.status === 'pending' ? 'is-pending' : ''}`}>
              <div className="my-appts__date">
                <strong>{longDate(a.meeting_date)}</strong>
                {a.meeting_date === today && <span className="chip evt-card__today">Hoy</span>}
                <span>
                  <Icon name="clock" size={13} /> {timeLabel(a)}
                  {a.location ? ` · ${a.location}` : ''}
                </span>
              </div>
              <div className="my-appts__topic">
                <strong>{a.topic}</strong>
                {a.student_name && <span className="text-muted">Sobre {a.student_name}</span>}
              </div>
              <div className="my-appts__action">
                <Badge variant={meta.variant}>{meta.short || meta.label}</Badge>
                {a.status === 'pending' ? (
                  <Button size="sm" icon="checkCircle" onClick={() => confirm(a)} loading={confirming === a.id} loadingText="Confirmando…">
                    Confirmar asistencia
                  </Button>
                ) : (
                  a.confirmed_at && <span className="text-sm text-muted">Confirmada el {new Date(a.confirmed_at).toLocaleDateString('es')}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default MyAppointments;
