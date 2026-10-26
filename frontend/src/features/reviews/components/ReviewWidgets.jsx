import { useEffect, useState } from 'react';
import reviewsApi from '../../../api/endpoints/reviews.api';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import { useLiveRefresh } from '../../../hooks/useLiveRefresh';
import { REVIEW_STATUSES } from '../reviewCatalog';
import ReviewDrawer from './ReviewDrawer';

/** Insignia del estado de revisión. */
export function ReviewStatusBadge({ status }) {
  const s = REVIEW_STATUSES[status] || REVIEW_STATUSES.borrador;
  return (
    <Badge variant={s.variant}>{s.label}</Badge>
  );
}

/**
 * Estado + botón "Revisión" que abre el panel lateral. Si no se pasa `status`,
 * lo consulta (p. ej. el contenido programático de una materia).
 */
export function ReviewButton({ target, title, status: known, onChanged }) {
  const [status, setStatus] = useState(known || null);
  const [open, setOpen] = useState(false);
  const key = target.planId || `${target.gradeId}|${target.subjectId}`;

  useEffect(() => {
    if (known) return setStatus(known);
    let alive = true;
    reviewsApi
      .get(target)
      .then((r) => alive && setStatus(r.status))
      .catch(() => alive && setStatus(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known]);

  return (
    <>
      {status && <ReviewStatusBadge status={status} />}
      <Button variant="secondary" icon="clipboard" onClick={() => setOpen(true)}>
        Revisión
      </Button>
      {open && (
        <ReviewDrawer
          target={target}
          title={title}
          onClose={() => setOpen(false)}
          onChanged={(r) => {
            setStatus(r.status);
            onChanged?.(r);
          }}
        />
      )}
    </>
  );
}

const when = (d) => (d ? new Date(d).toLocaleDateString('es', { day: '2-digit', month: 'short' }) : '');

/**
 * Bandeja del revisor (coordinador de su nivel o Director): lo que espera
 * revisión. `type`: 'plan' | 'content' para mostrar solo un tipo. No se muestra
 * a quien no revisa ni si no hay pendientes. Se actualiza sola.
 */
export function ReviewInbox({ type, onChanged }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => reviewsApi.inbox().then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(load, 30000);

  const items = (data?.items || []).filter((i) => !type || i.type === type);
  if (!data?.reviewer || !items.length) return null;
  return (
    <section className="card review-inbox" aria-label="Pendientes de revisión">
      <div className="review-inbox__head">
        <span className="review-inbox__icon" aria-hidden="true">
          <Icon name="clipboard" size={18} />
          <span className="review-inbox__count">{items.length}</span>
        </span>
        <div>
          <h3 className="card__title">Pendientes de revisión</h3>
          <p className="card__subtitle">{data.level ? `Coordinación de ${data.level.name}` : 'Todos los niveles'} · los más antiguos primero</p>
        </div>
      </div>
      <ul className="review-inbox__list">
        {items.map((i) => (
          <li key={i.planId || `${i.gradeId}|${i.subjectId}`}>
            <button type="button" className="review-inbox__item" onClick={() => setOpen(i)}>
              <Icon name={i.type === 'plan' ? 'clipboard' : 'layers'} size={16} />
              <span className="review-inbox__text">
                <strong>{i.title}</strong>
                <small>
                  {i.type === 'plan' ? 'Plan de evaluación' : 'Contenido programático'}
                  {i.teacher_name || i.submitted_by_name ? ` • ${i.teacher_name || i.submitted_by_name}` : ''}
                  {i.submitted_at ? ` • enviado el ${when(i.submitted_at)}` : ''}
                </small>
              </span>
              <span className="review-inbox__go">
                Revisar <Icon name="chevronRight" size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <ReviewDrawer
          target={open.type === 'plan' ? { planId: open.planId } : { gradeId: open.gradeId, subjectId: open.subjectId }}
          title={open.title}
          onClose={() => setOpen(null)}
          onChanged={(r) => {
            load();
            onChanged?.(r);
          }}
        />
      )}
    </section>
  );
}
