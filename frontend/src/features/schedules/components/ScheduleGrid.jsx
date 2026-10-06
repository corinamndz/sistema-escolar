import Icon from '../../../components/ui/Icon';

/**
 * Grilla semanal: días (lunes a viernes) en columnas y bloques horarios en
 * filas. Se usa en modo edición (arrastrar y soltar) y en solo lectura
 * (docente, portal de padres).
 *
 * Edición:
 *   - `cellState(day, slot)` → { conflict?: string, droppable?: boolean } para
 *     pintar la celda mientras se arrastra (rojo = cruce del docente).
 *   - `onCellDrop(day, slot)` al soltar; `onCellClick(day, slot)` para el modo
 *     tocar-y-colocar (pantallas táctiles, teclado).
 *   - `onEntryDragStart(entry)`, `onEntryRemove(entry)` sobre una clase.
 * `entryText(entry)` → { title, sub } de cada clase (por defecto materia y docente).
 *
 * Solo lectura:
 *   - `cellHint(day, slot)` → { className?, label?, title? } para marcar celdas
 *     (p. ej. los huecos o cruces de un docente);
 *   - `onEntryClick(entry)` hace cada clase clicable (p. ej. abrir su sección).
 */
function ScheduleGrid({
  days,
  slots,
  entries,
  editable = false,
  cellState,
  onCellDrop,
  onCellClick,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryRemove,
  entryText = (e) => ({ title: e.subject_name, sub: e.teacher_name }),
  colorOf,
  cellHint,
  onEntryClick,
}) {
  const at = (day, slotId) => entries.filter((e) => e.day_of_week === day && e.time_slot_id === slotId);

  if (!slots.length) return null;
  return (
    <div className="table-wrap schedule-grid__wrap">
      <table className="schedule-grid">
        <thead>
          <tr>
            <th className="schedule-grid__time">Hora</th>
            {days.map((d) => (
              <th key={d.day}>{d.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) =>
            slot.is_break ? (
              <tr key={slot.id} className="schedule-grid__break">
                <th className="schedule-grid__time">
                  <span>{slot.start_time}</span>
                  <small>{slot.end_time}</small>
                </th>
                <td colSpan={days.length}>
                  <Icon name="clock" size={14} /> {slot.name}
                </td>
              </tr>
            ) : (
              <tr key={slot.id}>
                <th className="schedule-grid__time">
                  <span>{slot.start_time}</span>
                  <small>{slot.end_time}</small>
                  <em>{slot.name}</em>
                </th>
                {days.map((d) => {
                  const list = at(d.day, slot.id);
                  const state = (editable && cellState?.(d.day, slot)) || {};
                  const hint = cellHint?.(d.day, slot) || {};
                  const classes = [
                    'schedule-grid__cell',
                    hint.className || '',
                    state.conflict ? 'is-conflict' : '',
                    state.droppable ? 'is-droppable' : '',
                    list.length ? 'is-filled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td
                      key={d.day}
                      className={classes}
                      title={state.conflict || hint.title || undefined}
                      onDragOver={
                        editable
                          ? (e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = state.conflict ? 'none' : 'move';
                            }
                          : undefined
                      }
                      onDrop={
                        editable
                          ? (e) => {
                              e.preventDefault();
                              onCellDrop?.(d.day, slot);
                            }
                          : undefined
                      }
                      onClick={editable && onCellClick ? () => onCellClick(d.day, slot) : undefined}
                    >
                      {list.map((entry) => {
                        const text = entryText(entry);
                        const clickable = !editable && onEntryClick;
                        return (
                          <div
                            key={entry.id}
                            className={`schedule-entry ${entry.teacher_changed ? 'has-warning' : ''} ${clickable ? 'is-clickable' : ''}`}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={
                              clickable
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      onEntryClick(entry);
                                    }
                                  }
                                : undefined
                            }
                            style={colorOf ? { '--entry-hue': colorOf(entry) } : undefined}
                            draggable={editable}
                            onDragStart={
                              editable
                                ? (e) => {
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', entry.id);
                                    onEntryDragStart?.(entry);
                                  }
                                : undefined
                            }
                            onDragEnd={editable ? () => onEntryDragEnd?.() : undefined}
                            onClick={editable ? (e) => e.stopPropagation() : clickable ? () => onEntryClick(entry) : undefined}
                          >
                            <strong>{text.title}</strong>
                            {text.sub && <span>{text.sub}</span>}
                            {entry.teacher_changed && (
                              <span
                                className="schedule-entry__warn"
                                title="La carga docente de esta materia cambió: vuelve a colocarla para tomar el profesor actual."
                              >
                                <Icon name="alertTriangle" size={12} /> Cambió el profesor
                              </span>
                            )}
                            {editable && onEntryRemove && (
                              <button
                                type="button"
                                className="schedule-entry__remove"
                                onClick={() => onEntryRemove(entry)}
                                aria-label={`Quitar ${text.title}`}
                              >
                                <Icon name="x" size={12} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {state.conflict && !list.length && <span className="schedule-grid__conflict-hint">Cruce</span>}
                      {!state.conflict && hint.label && !list.length && <span className="schedule-grid__hint">{hint.label}</span>}
                    </td>
                  );
                })}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Tono estable (0–359) para colorear cada materia igual en toda la grilla. */
export function hueOf(key = '') {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default ScheduleGrid;
