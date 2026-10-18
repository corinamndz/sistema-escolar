/** Tipos de evento de la cartelera (mismos códigos que el backend). */
export const EVENT_CATEGORIES = {
  cultural: { label: 'Cultural', icon: 'sparkles' },
  familiar: { label: 'Familiar', icon: 'home' },
  asamblea: { label: 'Asamblea', icon: 'users' },
  deportivo: { label: 'Deportivo', icon: 'star' },
  institucional: { label: 'Institucional', icon: 'building' },
  otro: { label: 'Otro', icon: 'calendar' },
  // Citas con padres: vienen del módulo de citas (no se crean desde la cartelera).
  cita: { label: 'Cita con padres', icon: 'clock' },
};
/** Tipos que se eligen al crear un evento de la cartelera. */
export const EDITABLE_CATEGORIES = Object.fromEntries(Object.entries(EVENT_CATEGORIES).filter(([key]) => key !== 'cita'));
export const categoryOf = (code) => EVENT_CATEGORIES[code] || EVENT_CATEGORIES.otro;

export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Fechas 'YYYY-MM-DD' en UTC (sin corrimientos de zona horaria).
export const parseDay = (s) => new Date(`${s}T12:00:00Z`);
export const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** '2026-10-20' → "martes 20 de octubre de 2026" */
export const longDate = (s) => {
  const d = parseDay(s);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
};
/** '2026-10-20' → { weekday: 'mar', day: 20, month: 'oct' } (para la insignia de la tarjeta). */
export const dateParts = (s) => {
  const d = parseDay(s);
  return { weekday: DAYS[d.getUTCDay()].slice(0, 3), day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()].slice(0, 3) };
};

/** Horario del evento: "17:00" o "08:00 – 11:30". */
export const timeLabel = (ev) => (ev.end_time ? `${ev.start_time} – ${ev.end_time}` : ev.start_time || '');

/** Extracto de la descripción para las tarjetas (corta en una palabra). */
export const excerpt = (text, max = 140) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return `${t.slice(0, cut > 60 ? cut : max).trimEnd()}…`;
};
