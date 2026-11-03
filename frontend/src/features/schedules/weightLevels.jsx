/**
 * Ponderación de una evaluación en el calendario de evaluaciones. La calcula el
 * servidor (evaluationCalendar.service → weightLevelOf) a partir de su tipo y su
 * porcentaje, así que no se guarda y los registros anteriores se clasifican solos:
 *   high    Ponderación alta: examen, proyecto o 20 % o más del lapso (antes "Pesada")
 *   medium  Ponderación media: 10 % a menos de 20 %
 *   low     Ponderación baja: menos de 10 %
 */
export const WEIGHT_LEVELS = {
  high: { label: 'Ponderación alta', short: 'Alta' },
  medium: { label: 'Ponderación media', short: 'Media' },
  low: { label: 'Ponderación baja', short: 'Baja' },
};
export const WEIGHT_LEVEL_KEYS = ['high', 'medium', 'low'];

/** Nivel de una evaluación (con respaldo para respuestas que solo traen `heavy`). */
export const weightLevelOf = (e) => e.weight_level || (e.heavy ? 'high' : Number(e.weight_percent) >= 10 ? 'medium' : 'low');

/** Punto de color del nivel (leyenda, tarjetas del calendario y detalle). */
export function WeightDot({ level, label = false }) {
  return (
    <span className={`weight-level weight-level--${level}`} title={WEIGHT_LEVELS[level].label} aria-label={label ? undefined : WEIGHT_LEVELS[level].label}>
      <span className="weight-level__dot" aria-hidden="true" />
      {label && WEIGHT_LEVELS[level].label}
    </span>
  );
}
