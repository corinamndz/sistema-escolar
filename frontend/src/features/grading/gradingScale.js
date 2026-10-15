/**
 * Escalas de calificación por grado (migración 023). Debe coincidir con
 * backend/src/modules/grading/gradingScale.js.
 *
 * Toda nota se guarda y se calcula como número sobre 20; en los grados
 * cualitativos solo se CARGA y se MUESTRA como literal (A–E).
 */
export const SCALE_MAX = 20;

export const GRADING_SCALES = {
  quantitative: { label: 'Cuantitativa', short: 'Numérica 0–20', icon: 'trendingUp', hint: 'Notas numéricas del 0 al 20, con sus promedios.' },
  qualitative: { label: 'Cualitativa', short: 'Literal A–E', icon: 'star', hint: 'Literales A–E con su concepto (Excelente, Bueno…).' },
};

export const QUALITATIVE_LEVELS = [
  { code: 'A', label: 'Excelente', min: 18, value: 19 },
  { code: 'B', label: 'Muy bueno', min: 15, value: 16 },
  { code: 'C', label: 'Bueno', min: 12, value: 13 },
  { code: 'D', label: 'Regular', min: 10, value: 11 },
  { code: 'E', label: 'Deficiente', min: 0, value: 7 },
];

/** Literal de una nota sobre 20 (o null si no hay nota). */
export function literalFor(score20) {
  if (score20 === null || score20 === undefined || Number.isNaN(Number(score20))) return null;
  return QUALITATIVE_LEVELS.find((l) => Number(score20) >= l.min) || QUALITATIVE_LEVELS[QUALITATIVE_LEVELS.length - 1];
}

/** Literal de `raw` sobre `max` (p. ej. 85/100 → 17/20 → B). */
export const literalOf = (raw, max) => (raw === null || raw === undefined || !max ? null : literalFor((Number(raw) / Number(max)) * SCALE_MAX));

/** Rango legible de un literal: "18 – 20", "15 – 17,99"… */
export function rangeOf(level) {
  const i = QUALITATIVE_LEVELS.indexOf(level);
  const upper = i === 0 ? SCALE_MAX : QUALITATIVE_LEVELS[i - 1].min - 0.01;
  return `${level.min} – ${String(upper).replace('.', ',')}`;
}

export const isQualitative = (scale) => scale === 'qualitative';
