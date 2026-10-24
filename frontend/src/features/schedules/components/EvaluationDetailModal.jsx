import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import Drawer from '../../../components/ui/Drawer';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { hueOf } from './ScheduleGrid';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Estado de la evaluación en la sección (ver evaluationCalendar.service). */
export const EVAL_STATUS = {
  scheduled: { label: 'Programada', variant: 'info', icon: 'calendar' },
  pending: { label: 'Pendiente de calificar', variant: 'warning', icon: 'clock' },
  in_progress: { label: 'En curso (calificación parcial)', variant: 'primary', icon: 'pencil' },
  graded: { label: 'Calificada', variant: 'success', icon: 'checkCircle' },
  unscheduled: { label: 'Sin fecha', variant: 'neutral', icon: 'alertTriangle' },
};

/** '2026-09-22' → "martes 22 de septiembre de 2026" (sin corrimiento de zona horaria). */
function longDate(date, dayName) {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  return `${dayName ? `${dayName.toLowerCase()} ` : ''}${d} de ${MONTHS[m - 1]} de ${y}`;
}

function Fact({ icon, label, children }) {
  return (
    <div className="eval-detail__fact">
      <span className="eval-detail__fact-icon">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <span className="eval-detail__fact-label">{label}</span>
        <div className="eval-detail__fact-value">{children}</div>
      </div>
    </div>
  );
}

/**
 * Detalle de una evaluación del horario de evaluaciones (al hacer clic en su
 * tarjeta): actividad, materia y docente, lapso, fecha y hora (del horario de
 * clases), peso, descripción (y, en formato detallado, estrategia y
 * contenidos), y estado de calificación en la sección. Se cierra con la X,
 * haciendo clic fuera o con Esc. Accesos directos al plan y a la libreta
 * según los permisos del usuario.
 */
function EvaluationDetailModal({ evaluation: e, section, onClose }) {
  const { can } = useAuth();
  const status = EVAL_STATUS[e.status] || EVAL_STATUS.scheduled;
  const hue = hueOf(e.subject_id || e.subject_name);
  const progress = e.student_count ? Math.round((e.graded_count / e.student_count) * 100) : 0;
  const when = e.blocks?.length
    ? e.blocks.map((b) => `${b.start_time}–${b.end_time} (${b.name})`).join(' y ')
    : e.date
      ? 'Sin bloque: la materia no tiene clase ese día en el horario.'
      : null;

  return (
    <Drawer title={e.title} onClose={onClose}>
      <div className="eval-detail" style={{ '--entry-hue': hue }}>
        <div className="eval-detail__hero">
          <span className="eval-detail__subject">
            {e.subject_name}
            {e.subject_code && <span className="chip">{e.subject_code}</span>}
          </span>
          <div className="eval-detail__badges">
            <Badge variant={status.variant}>
              <Icon name={status.icon} size={12} /> {status.label}
            </Badge>
            <Badge variant="neutral">{e.category_label}</Badge>
            {e.heavy && (
              <Badge variant="danger">
                <span className="evalcal__heavy-dot" /> Pesada
              </Badge>
            )}
            {e.plan_status === 'closed' && <Badge variant="neutral">Plan cerrado</Badge>}
          </div>
        </div>

        <div className="eval-detail__facts">
          <Fact icon="calendar" label="Fecha">
            {e.date ? (
              <>
                {longDate(e.date, e.day_name)}
                {e.date_source === 'section' && <span className="eval-detail__note"> · fecha propia de la sección</span>}
              </>
            ) : (
              <span className="text-muted">Sin fecha en el plan de evaluación</span>
            )}
          </Fact>
          {when && (
            <Fact icon="clock" label="Hora">
              {e.blocks?.length ? when : <span className="text-muted">{when}</span>}
            </Fact>
          )}
          <Fact icon="user" label="Docente">
            {e.teacher_name ? `Prof. ${e.teacher_name}` : <span className="text-muted">Sin docente</span>}
          </Fact>
          <Fact icon="layers" label="Lapso y sección">
            {e.term_name}
            {section ? ` · ${section.grade_name} ${section.name}` : ''}
          </Fact>
          <Fact icon="trendingUp" label="Ponderación">
            <strong>{e.weight_percent}%</strong> del lapso · sobre {e.max_score} puntos
          </Fact>
          <Fact icon="clipboard" label="Formato del plan">
            {e.plan_format === 'detailed' ? 'Detallado (criterios e indicadores)' : 'Simple'}
          </Fact>
        </div>

        {(e.description || e.strategy || e.content_refs?.length > 0) && (
          <div className="eval-detail__body">
            {e.description && (
              <section>
                <span className="student-card__label">Descripción</span>
                <p>{e.description}</p>
              </section>
            )}
            {e.strategy && (
              <section>
                <span className="student-card__label">Estrategia de evaluación</span>
                <p>{e.strategy}</p>
              </section>
            )}
            {e.content_refs?.length > 0 && (
              <section>
                <span className="student-card__label">Contenidos</span>
                <ul className="eval-detail__topics">
                  {e.content_refs.map((t, i) => (
                    <li key={i}>
                      <strong>{t.topic}</strong>
                      {t.subtopics?.length > 0 && <span className="text-muted"> — {t.subtopics.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Portal del representante: el estado de SU alumno (sin estadísticas de la sección). */}
        {e.student_graded !== undefined ? (
          <div className={`eval-detail__mine ${e.student_graded ? 'is-graded' : ''}`}>
            <Icon name={e.student_graded ? 'checkCircle' : e.date ? 'clock' : 'calendar'} size={16} />
            {e.student_graded
              ? 'Tu representado ya tiene nota en esta evaluación: consúltala en la pestaña Calificaciones.'
              : e.status === 'pending'
                ? 'La fecha ya pasó y la nota aún no está cargada.'
                : e.date
                  ? 'Evaluación programada: aún no tiene nota.'
                  : 'El docente todavía no le asignó fecha.'}
          </div>
        ) : (
          <div className="eval-detail__progress">
            <div className="coverage__head">
              <span>
                Calificación: <strong>{e.graded_count}</strong> de {e.student_count} alumno{e.student_count === 1 ? '' : 's'}
              </span>
              <span className="text-muted">{progress}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="form-actions eval-detail__actions">
          {can('evaluation_plans', 'read') && (
            <Link to={`/evaluation-plans/${e.plan_id}`} className="btn btn--secondary" onClick={onClose}>
              <Icon name="clipboard" size={16} /> {can('evaluation_plans', 'update') ? 'Editar en el plan' : 'Ver plan de evaluación'}
            </Link>
          )}
          {can('grading', 'read') && (
            <Link to={`/grading/plans/${e.plan_id}`} className="btn btn--primary" onClick={onClose}>
              <Icon name="graduation" size={16} /> {can('grading', 'update') ? 'Calificar' : 'Ver calificaciones'}
            </Link>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Drawer>
  );
}

export default EvaluationDetailModal;
