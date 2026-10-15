/**
 * Escalas de calificación (migración 023).
 *
 *   quantitative  numérica 0–20.
 *   qualitative   literales A–E. Cada literal cubre un rango de la escala de
 *                 20 y guarda un valor representativo: así los cálculos
 *                 (promedios, promoción, historial) son siempre numéricos y la
 *                 escala solo cambia cómo se CARGA y se MUESTRA la nota.
 *
 * Debe coincidir con frontend/src/features/grading/gradingScale.js.
 */
const GRADING_SCALES = ['quantitative', 'qualitative'];
const SCALE_MAX = 20;

const QUALITATIVE_LEVELS = [
  { code: 'A', label: 'Excelente', min: 18, value: 19 },
  { code: 'B', label: 'Muy bueno', min: 15, value: 16 },
  { code: 'C', label: 'Bueno', min: 12, value: 13 },
  { code: 'D', label: 'Regular', min: 10, value: 11 },
  { code: 'E', label: 'Deficiente', min: 0, value: 7 },
];

/** Literal de una nota sobre 20 (o null si no hay nota). */
function literalFor(score20) {
  if (score20 === null || score20 === undefined || Number.isNaN(Number(score20))) return null;
  return QUALITATIVE_LEVELS.find((l) => Number(score20) >= l.min) || QUALITATIVE_LEVELS[QUALITATIVE_LEVELS.length - 1];
}

/** Valor numérico que guarda un literal, llevado al puntaje máximo de la actividad. */
function scoreForLiteral(code, maxScore = SCALE_MAX) {
  const level = QUALITATIVE_LEVELS.find((l) => l.code === String(code).toUpperCase());
  if (!level) return null;
  return Math.round((level.value / SCALE_MAX) * Number(maxScore) * 100) / 100;
}

/** Definición para enviar al cliente. */
const scaleDefinition = () => ({ max: SCALE_MAX, qualitative_levels: QUALITATIVE_LEVELS });

module.exports = { GRADING_SCALES, SCALE_MAX, QUALITATIVE_LEVELS, literalFor, scoreForLiteral, scaleDefinition };
