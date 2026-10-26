import { useEffect, useRef, useState } from 'react';
import reviewsApi from '../../../api/endpoints/reviews.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import Drawer from '../../../components/ui/Drawer';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { REVIEW_STATUSES, ENTRY_LABELS } from '../reviewCatalog';

const when = (d) => (d ? new Date(d).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** Una entrada del hilo: mensaje (burbuja) o cambio de estado (línea centrada). */
function Entry({ c, mine }) {
  if (c.kind === 'reset') {
    return (
      <li className="review-thread__event is-reset">
        <Icon name="refresh" size={13} /> {c.body} <time>{when(c.created_at)}</time>
      </li>
    );
  }
  const status = c.kind !== 'comment';
  return (
    <li className={`review-msg ${mine ? 'is-mine' : ''} ${status ? `is-${c.kind}` : ''}`}>
      <span className="review-msg__avatar" aria-hidden="true">
        {initials(c.author_name)}
      </span>
      <div className="review-msg__bubble">
        <div className="review-msg__meta">
          <strong>{c.author_name || 'Usuario'}</strong>
          {c.author_role_label && <span className="review-msg__role">{c.author_role_label}</span>}
          <time>{when(c.created_at)}</time>
        </div>
        {status && (
          <div className="review-msg__status">
            <Icon name={c.kind === 'approved' ? 'checkCircle' : c.kind === 'observed' ? 'alertTriangle' : 'arrowRight'} size={14} /> {ENTRY_LABELS[c.kind]}
          </div>
        )}
        {c.body && <p>{c.body}</p>}
      </div>
    </li>
  );
}

/**
 * Panel lateral de revisión de un plan de evaluación o del contenido
 * programático de una materia en un grado:
 *   - Estado actual y quién lo envió / revisó.
 *   - "Comentarios de revisión": hilo tipo chat con los cambios de estado.
 *   - Coordinador (de su nivel) o Director: "Devolver con observaciones" y "Aprobar".
 *   - Docente: "Enviar a revisión" / "Reenviar a revisión" tras ajustar.
 * `target`: { planId } | { gradeId, subjectId }. `onChanged(review)` al cambiar el estado.
 */
function ReviewDrawer({ target, title, onClose, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const drawer = useRef(null);
  const listRef = useRef(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // 'submit' | 'observe' | 'approve' | 'reopen' | 'comment'
  const what = target.planId ? 'plan' : 'contenido';

  useEffect(() => {
    let alive = true;
    reviewsApi
      .get(target)
      .then((r) => alive && setReview(r))
      .catch((err) => alive && setError(getErrorMessage(err)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.planId, target.gradeId, target.subjectId]);

  // El hilo baja solo al último mensaje.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [review?.comments?.length]);

  const run = async (kind, fn, okText) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await fn();
      setReview(next);
      setText('');
      if (okText) toast.success(okText, review?.title);
      if (kind !== 'comment') onChanged?.(next);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const status = review ? REVIEW_STATUSES[review.status] : null;
  const can = review?.can || {};
  const resend = review?.status === 'observado';
  const trimmed = text.trim();

  const footer = review && (
    <div className="review-actions">
      {can.reopen && (
        <Button
          variant="secondary"
          icon="refresh"
          loading={busy === 'reopen'}
          disabled={Boolean(busy)}
          title="Vuelve a borrador para que el docente pueda cambiarlo y reenviarlo"
          onClick={() => run('reopen', () => reviewsApi.review(target, 'reopen', trimmed), 'Reabierto para cambios')}
        >
          Reabrir para cambios
        </Button>
      )}
      {can.review && (
        <>
          <Button
            variant="secondary"
            icon="alertTriangle"
            loading={busy === 'observe'}
            disabled={Boolean(busy) || !trimmed}
            title={trimmed ? '' : 'Escribe en el cuadro de comentarios qué debe ajustar el docente'}
            onClick={() => run('observe', () => reviewsApi.review(target, 'observe', trimmed), 'Ajustes solicitados')}
          >
            Solicitar ajustes
          </Button>
          <Button icon="checkCircle" loading={busy === 'approve'} disabled={Boolean(busy)} onClick={() => run('approve', () => reviewsApi.review(target, 'approve', trimmed), what === 'plan' ? 'Plan aprobado' : 'Contenido aprobado')}>
            {what === 'plan' ? 'Aprobar plan' : 'Aprobar contenido'}
          </Button>
        </>
      )}
      {can.submit && (
        <Button icon="arrowRight" loading={busy === 'submit'} disabled={Boolean(busy)} onClick={() => run('submit', () => reviewsApi.submit(target, trimmed), resend ? 'Reenviado a revisión' : 'Enviado a revisión')}>
          {resend ? 'Reenviar a revisión' : 'Enviar a revisión'}
        </Button>
      )}
      {!can.review && !can.submit && !can.reopen && (
        <Button variant="secondary" onClick={() => drawer.current?.close()}>
          Cerrar
        </Button>
      )}
    </div>
  );

  return (
    <Drawer ref={drawer} title="Revisión" subtitle={review?.title || title} icon="clipboard" onClose={onClose} busy={Boolean(busy)} footer={footer}>
      <Alert>{error}</Alert>
      {review && review.enabled === false && (
        <Alert variant="info">La revisión académica está desactivada en este colegio: el contenido se publica al guardarlo. Se activa en Configuración → Revisión académica.</Alert>
      )}
      {!review ? (
        !error && <Spinner label="Cargando revisión…" />
      ) : (
        <div className="review">
          <section className={`review-status is-${review.status}`}>
            <Icon name={status.icon} size={20} />
            <div>
              <div className="review-status__row">
                <Badge variant={status.variant}>{review.status_label}</Badge>
                {review.level_name && <span className="text-sm text-muted">Nivel {review.level_name}</span>}
              </div>
              <p>
                {review.status === 'observado' && review.my_role === 'author'
                  ? 'Coordinación pidió ajustes. Corrige lo indicado abajo y reenvía.'
                  : review.status === 'en_revision' && review.my_role === 'reviewer'
                    ? 'Espera tu revisión: apruébalo o solicita ajustes dejando tus comentarios.'
                    : review.locked && review.status === 'en_revision'
                      ? 'Coordinación lo está revisando: no se puede editar hasta su respuesta.'
                      : review.locked && review.status === 'aprobado'
                        ? 'Aprobado de forma definitiva. Si necesitas cambiarlo, pide a coordinación que lo reabra.'
                        : status.hint}
              </p>
              <dl className="review-status__meta">
                {review.teacher_name && (
                  <div>
                    <dt>Docente</dt>
                    <dd>{review.teacher_name}</dd>
                  </div>
                )}
                {review.submitted_at && (
                  <div>
                    <dt>Enviado</dt>
                    <dd>
                      {when(review.submitted_at)}
                      {review.submitted_by_name ? ` · ${review.submitted_by_name}` : ''}
                    </dd>
                  </div>
                )}
                {review.reviewed_at && (
                  <div>
                    <dt>Revisado</dt>
                    <dd>
                      {when(review.reviewed_at)}
                      {review.reviewed_by_name ? ` · ${review.reviewed_by_name}` : ''}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>

          <section className="review-thread" aria-label="Comentarios de revisión">
            <h4 className="drawer-section__title">
              <Icon name="inbox" size={16} /> Comentarios de revisión
            </h4>
            {review.comments.length === 0 ? (
              <p className="review-thread__empty">Aún no hay comentarios. {can.submit ? 'Puedes dejar una nota al enviar.' : ''}</p>
            ) : (
              <ul className="review-thread__list" ref={listRef}>
                {review.comments.map((c) => (
                  <Entry key={c.id} c={c} mine={c.user_id === user?.id} />
                ))}
              </ul>
            )}

            {can.comment && (
              <div className="review-composer">
                <textarea
                  className="input"
                  rows={3}
                  maxLength={4000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    can.review ? 'Comentarios para el docente (obligatorios al solicitar ajustes)…' : can.submit ? 'Comentario para coordinación (opcional al enviar)…' : 'Escribe un comentario…'
                  }
                  aria-label="Comentario"
                  disabled={Boolean(busy)}
                />
                <div className="review-composer__bar">
                  <span className="text-sm text-muted">
                    {can.review ? 'Se envía junto con tu decisión, o como comentario suelto.' : can.submit ? 'Se adjunta al enviar, o publícalo como comentario.' : ''}
                  </span>
                  <Button size="sm" variant="ghost" icon="inbox" loading={busy === 'comment'} disabled={Boolean(busy) || !trimmed} onClick={() => run('comment', () => reviewsApi.comment(target, trimmed))}>
                    Comentar
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export default ReviewDrawer;
