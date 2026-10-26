const day = (d) => String(d || '').slice(0, 10);

/** Fecha local de hoy 'YYYY-MM-DD' (no UTC: en Venezuela, de noche, UTC ya es "mañana"). */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Año escolar que se abre por defecto: el activo que contiene la fecha de hoy;
 * si no hay, el activo que empezó más recientemente (sin contar los que aún no
 * empiezan, como el año siguiente ya creado con «Preparar nuevo año»); si no,
 * el activo o el más reciente.
 */
export function currentPeriod(periods) {
  if (!periods?.length) return null;
  const today = todayLocal();
  const open = periods.filter((p) => !p.closed_at).sort((a, b) => day(b.start_date).localeCompare(day(a.start_date)));
  return (
    open.find((p) => p.is_active && day(p.start_date) <= today && (!p.end_date || day(p.end_date) >= today)) ||
    open.find((p) => p.is_active && day(p.start_date) <= today) ||
    open.find((p) => p.is_active) ||
    open[0] ||
    periods[0]
  );
}
