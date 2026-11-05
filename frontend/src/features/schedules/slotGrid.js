/**
 * Jornadas por nivel (migración 074): cada nivel puede tener sus propios
 * bloques y recreos. Utilidades para dibujar en UNA grilla bloques de varias
 * jornadas (mismo criterio que schedule.service → mergeSlots).
 */

export const LEVEL_SHORT = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };

const toMin = (t) => {
  const [h, m] = String(t || '0:0').slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

/**
 * Une bloques de varias jornadas: los de mismas horas van en una fila (la
 * representa el de la jornada general si lo hay); un bloque de una sola
 * jornada de nivel se rotula con el nivel. → { slots, alias: Map(id → id de su fila) }
 */
export function mergeSlotRows(slots = []) {
  const rows = new Map();
  const alias = new Map();
  const ordered = [...slots].sort(
    (a, b) => toMin(a.start_time) - toMin(b.start_time) || toMin(a.end_time) - toMin(b.end_time) || (a.level_code ? 1 : 0) - (b.level_code ? 1 : 0)
  );
  ordered.forEach((s) => {
    const key = `${s.start_time}|${s.end_time}|${Boolean(s.is_break)}`;
    if (!rows.has(key)) rows.set(key, { ...s, levels: new Set() });
    rows.get(key).levels.add(s.level_code || '*');
    alias.set(s.id, rows.get(key).id);
  });
  const structures = new Set(slots.map((s) => s.level_code || '*')).size;
  return {
    slots: [...rows.values()].map(({ levels, ...s }) => {
      const only = levels.size === 1 ? [...levels][0] : null;
      return structures > 1 && only && only !== '*' ? { ...s, name: `${s.name} · ${LEVEL_SHORT[only] || only}` } : s;
    }),
    alias,
  };
}
