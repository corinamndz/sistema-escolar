import Icon from '../../../components/ui/Icon';

/**
 * Categorías de reconocimiento: etiqueta, ícono y tono de su tarjeta festiva.
 * (Mismas claves que la restricción CHECK de student_recognitions.)
 */
export const RECOGNITION_CATEGORIES = {
  excellence: { label: 'Excelencia académica', icon: 'graduation', tone: 'gold', suggestions: ['Cuadro de honor', 'Mejor promedio del lapso', 'Excelencia en Matemática'] },
  effort: { label: 'Esfuerzo y superación', icon: 'trendingUp', tone: 'coral', suggestions: ['Gran esfuerzo y constancia', 'Superación personal', 'Mayor progreso del lapso'] },
  conduct: { label: 'Conducta ejemplar', icon: 'shield', tone: 'teal', suggestions: ['Conducta ejemplar', 'Respeto y responsabilidad', 'Puntualidad y orden'] },
  leadership: { label: 'Liderazgo', icon: 'award', tone: 'violet', suggestions: ['Líder positivo del aula', 'Jefe de sección destacado'] },
  solidarity: { label: 'Compañerismo y solidaridad', icon: 'users', tone: 'rose', suggestions: ['Mejor compañero', 'Espíritu solidario'] },
  sports: { label: 'Deportes', icon: 'star', tone: 'sky', suggestions: ['Destacado en deportes', 'Medalla en los juegos intercursos'] },
  arts: { label: 'Arte y cultura', icon: 'sparkles', tone: 'violet', suggestions: ['Talento artístico', 'Destacado en el acto cultural'] },
  other: { label: 'Logro especial', icon: 'star', tone: 'gold', suggestions: ['Reconocimiento especial'] },
};

const longDate = (d) =>
  d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

/**
 * Tarjeta de celebración de un reconocimiento: la ve la familia en la campana,
 * el Centro de notificaciones y el portal (y el personal, como vista previa).
 * `r`: { student_name, grade_name?, section_name?, category, category_label?,
 *        title, message, awarded_by_name, awarded_by_role?, awarded_on }
 * `compact`: versión para listas (sin confeti ni cinta).
 */
export function RecognitionCelebration({ recognition: r, compact = false }) {
  const meta = RECOGNITION_CATEGORIES[r.category] || RECOGNITION_CATEGORIES.other;
  const first = (r.student_name || '').split(' ')[0];
  return (
    <article className={`rec-card rec-card--${meta.tone} ${compact ? 'rec-card--compact' : ''}`} aria-label={`Reconocimiento: ${r.title}`}>
      {!compact && <span className="rec-card__confetti" aria-hidden="true" />}
      <div className="rec-card__medal" aria-hidden="true">
        <span className="rec-card__ring">
          <Icon name={meta.icon} size={compact ? 20 : 30} />
        </span>
        {!compact && (
          <span className="rec-card__ribbons">
            <span />
            <span />
          </span>
        )}
      </div>
      <div className="rec-card__body">
        {!compact && <p className="rec-card__kicker">¡Felicitaciones, {first}!</p>}
        <span className="rec-card__category">
          <Icon name="star" size={12} /> {r.category_label || meta.label}
        </span>
        <h3 className="rec-card__title">{r.title}</h3>
        <p className="rec-card__student">
          <strong>{r.student_name}</strong>
          {r.grade_name && (
            <span>
              {' '}
              · {r.grade_name}
              {r.section_name ? ` ${r.section_name}` : ''}
            </span>
          )}
        </p>
        <blockquote className="rec-card__message">{r.message}</blockquote>
        <footer className="rec-card__footer">
          <span>
            <Icon name="award" size={14} /> Otorgado por <strong>{r.awarded_by_name}</strong>
            {r.awarded_by_role ? ` (${r.awarded_by_role})` : ''}
          </span>
          <span>
            <Icon name="calendar" size={14} /> {longDate(r.awarded_on)}
          </span>
        </footer>
      </div>
    </article>
  );
}

export default RecognitionCelebration;
