import { useState } from 'react';
import { Link } from 'react-router-dom';
import portalApi from '../../../api/endpoints/portal.api';
import { useFetch } from '../../../hooks/useFetch';
import Icon from '../../../components/ui/Icon';
import EventDetailModal from '../../events/components/EventDetailModal';
import { categoryOf, dateParts, timeLabel } from '../../events/eventCatalog';

/**
 * Próximos eventos del colegio en el inicio del portal (los 3 más cercanos),
 * con acceso a la cartelera completa. No se muestra si no hay ninguno.
 */
function UpcomingEvents() {
  const { data } = useFetch(() => portalApi.getEvents(), []);
  const [viewing, setViewing] = useState(null);
  const next = (data || []).filter((e) => !e.is_past).slice(0, 3);
  if (!next.length) return null;

  return (
    <section className="card evt-upcoming">
      <div className="card__header">
        <div>
          <h3 className="card__title">Próximos eventos</h3>
          <p className="card__subtitle">Actos, asambleas y actividades del colegio</p>
        </div>
        <Link to="/portal/events" className="btn btn--secondary btn--sm">
          <Icon name="calendar" size={15} /> Ver cartelera
        </Link>
      </div>
      <div className="evt-upcoming__list">
        {next.map((ev) => {
          const parts = dateParts(ev.event_date);
          return (
            <button key={ev.id} type="button" className={`evt-upcoming__item evt--${ev.category}`} onClick={() => setViewing(ev)}>
              <span className="evt-card__date evt-card__date--sm" aria-hidden="true">
                <span className="evt-card__day">{parts.day}</span>
                <span className="evt-card__month">{parts.month}</span>
              </span>
              <span className="evt-upcoming__body">
                <strong>{ev.title}</strong>
                <span className="text-sm text-muted">
                  {categoryOf(ev.category).label} · {parts.weekday} · {timeLabel(ev)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {viewing && <EventDetailModal event={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

export default UpcomingEvents;
