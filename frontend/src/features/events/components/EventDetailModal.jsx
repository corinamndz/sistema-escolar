import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { categoryOf, longDate, todayStr } from '../eventCatalog';

/**
 * Detalle de un evento de la cartelera: categoría, fecha y hora, lugar, a
 * quién va dirigido y la descripción completa. Lo usan la administración
 * (con `onEdit` / `onDelete`) y el portal del representante (solo lectura).
 */
function EventDetailModal({ event: ev, onClose, onEdit, onDelete, onManageAppointment }) {
  const cat = categoryOf(ev.category);
  const isAppointment = ev.kind === 'appointment';

  return (
    <Modal title={ev.title} onClose={onClose}>
      <div className={`evt-detail evt--${ev.category}`}>
        <div className="evt-detail__hero">
          <span className="evt-detail__icon">
            <Icon name={cat.icon} size={22} />
          </span>
          <div className="evt-detail__badges">
            <span className="evt-tag">{cat.label}</span>
            {isAppointment && ev.status_label && <span className="chip">{ev.status_label}</span>}
            {!ev.is_published && <span className="chip">Borrador · no visible en el portal</span>}
            {ev.is_past && <span className="chip">Finalizado</span>}
          </div>
        </div>

        <div className="evt-detail__facts">
          <div className="evt-fact">
            <Icon name="calendar" size={16} />
            <div>
              <span className="evt-fact__label">Fecha</span>
              <span className="evt-detail__date">{longDate(ev.event_date)}</span>
              {ev.event_date === todayStr() && <span className="chip evt-card__today">Hoy</span>}
            </div>
          </div>
          <div className="evt-fact">
            <Icon name="clock" size={16} />
            <div>
              <span className="evt-fact__label">Hora</span>
              {ev.end_time ? `De ${ev.start_time} a ${ev.end_time}` : `A las ${ev.start_time}`}
            </div>
          </div>
          {ev.location && (
            <div className="evt-fact">
              <Icon name="building" size={16} />
              <div>
                <span className="evt-fact__label">Lugar</span>
                {ev.location}
              </div>
            </div>
          )}
          <div className="evt-fact">
            <Icon name="users" size={16} />
            <div>
              <span className="evt-fact__label">{isAppointment ? 'Con' : 'Dirigido a'}</span>
              {ev.audience_label}
              {ev.audience === 'section' && ev.school_period_name ? ` · ${ev.school_period_name}` : ''}
              {ev.for_students?.length > 0 && <span className="evt-detail__kids">Aplica a: {ev.for_students.join(', ')}</span>}
            </div>
          </div>
        </div>

        {ev.description ? (
          <div className="evt-detail__description">{ev.description}</div>
        ) : isAppointment ? (
          ev.topic && <div className="evt-detail__description">Tema: {ev.topic}</div>
        ) : (
          <p className="text-muted text-sm">Sin descripción.</p>
        )}
        {ev.created_by_name && <p className="form-hint">Publicado por {ev.created_by_name}</p>}
      </div>

      <div className="form-actions">
        {onDelete && !isAppointment && (
          <Button type="button" variant="danger" icon="trash" onClick={onDelete} className="evt-detail__delete">
            Eliminar
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cerrar
        </Button>
        {onEdit && !isAppointment && (
          <Button type="button" icon="pencil" onClick={onEdit}>
            Editar
          </Button>
        )}
        {isAppointment && onManageAppointment && (
          <Button type="button" icon="arrowRight" onClick={onManageAppointment}>
            Ir a Citas con padres
          </Button>
        )}
      </div>
    </Modal>
  );
}

export default EventDetailModal;
