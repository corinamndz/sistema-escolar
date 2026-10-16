/** Categorías de los clubes (coinciden con el CHECK de la base, migración 026). */
export const CLUB_CATEGORIES = {
  musica: { label: 'Música', icon: 'star' },
  deporte: { label: 'Deporte', icon: 'trendingUp' },
  arte: { label: 'Arte', icon: 'sparkles' },
  ciencia: { label: 'Ciencia y tecnología', icon: 'layers' },
  idiomas: { label: 'Idiomas', icon: 'book' },
  otro: { label: 'Otra actividad', icon: 'clipboard' },
};

/**
 * Actividades sugeridas para crear un club rápido. Al final de la lista va
 * siempre la opción "OTRO", que abre un campo para escribir una actividad
 * nueva o personalizada.
 */
export const CLUB_SUGGESTIONS = [
  { name: 'Coro Escolar', category: 'musica' },
  { name: 'Banda Musical', category: 'musica' },
  { name: 'Estudiantina', category: 'musica' },
  { name: 'Fútbol', category: 'deporte' },
  { name: 'Baloncesto', category: 'deporte' },
  { name: 'Voleibol', category: 'deporte' },
  { name: 'Atletismo', category: 'deporte' },
  { name: 'Ajedrez', category: 'ciencia' },
  { name: 'Robótica', category: 'ciencia' },
  { name: 'Club de Ciencias', category: 'ciencia' },
  { name: 'Danza', category: 'arte' },
  { name: 'Teatro', category: 'arte' },
  { name: 'Artes Plásticas', category: 'arte' },
  { name: 'Oratoria', category: 'idiomas' },
  { name: 'Inglés Conversacional', category: 'idiomas' },
];

export const OTHER = '__OTRO__';

const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const localToday = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
/** '2026-10-14' → "mié 14/10" */
export const sessionLabel = (s) => {
  const d = new Date(`${s}T12:00:00Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** "14:00–15:30" o "desde 14:00" (vacío si no hay hora). */
export const timeRange = (c) => (c.start_time ? (c.end_time ? `${c.start_time}–${c.end_time}` : `desde ${c.start_time}`) : '');
/**
 * Resumen de las sesiones de un club: "Próxima: mié 14/10 · 14:00–15:30 · 12 sesiones".
 * Para clubes anteriores a las fechas (migración 027) cae al horario en texto.
 */
export function sessionSummary(c) {
  const dates = c.session_dates || [];
  if (!dates.length) return c.schedule_text || '';
  const next = c.next_session || dates.find((d) => d >= localToday());
  const parts = [next ? `Próxima: ${sessionLabel(next)}` : 'Sesiones finalizadas', timeRange(c), `${dates.length} sesi${dates.length === 1 ? 'ón' : 'ones'}`];
  return parts.filter(Boolean).join(' · ');
}
