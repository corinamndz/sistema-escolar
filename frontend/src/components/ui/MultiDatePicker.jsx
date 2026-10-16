import { useMemo, useState } from 'react';
import Icon from './Icon';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// Fechas 'YYYY-MM-DD' manejadas en UTC: sin corrimientos por zona horaria.
const parse = (s) => new Date(`${s}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
/** Lunes = 0 … domingo = 6 */
const isoIndex = (d) => (d.getUTCDay() + 6) % 7;
/** '2026-10-14' → "mié 14/10" */
export const chipLabel = (s) => {
  const d = parse(s);
  return `${SHORT_DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Selector MÚLTIPLE de fechas: un calendario desplegable donde se marcan y
 * desmarcan días concretos, y un atajo para repetir semanalmente (p. ej.
 * martes y jueves desde una fecha hasta otra). Las fechas elegidas se ven como
 * chips, agrupadas por mes, cada una con su botón para quitarla.
 *
 *   value     ['YYYY-MM-DD', …]
 *   onChange  (fechas ordenadas) => void
 *   max       cantidad máxima de fechas (por defecto 366)
 */
function MultiDatePicker({ value = [], onChange, max = 366, disabled }) {
  const selected = useMemo(() => new Set(value), [value]);
  const sorted = useMemo(() => [...value].sort(), [value]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = parse(sorted.find((d) => d >= todayStr()) || sorted[0] || todayStr());
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1, 12));
  });
  const [repeat, setRepeat] = useState({ days: [], from: todayStr(), to: '' });

  const commit = (set) => onChange([...set].sort().slice(0, max));
  const toggle = (date) => {
    const next = new Set(selected);
    if (next.has(date)) next.delete(date);
    else if (next.size < max) next.add(date);
    commit(next);
  };
  const remove = (date) => {
    const next = new Set(selected);
    next.delete(date);
    commit(next);
  };

  // Celdas del mes visible (semanas de lunes a domingo).
  const cells = useMemo(() => {
    const first = view;
    const start = addDays(first, -isoIndex(first));
    const out = [];
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(start, i);
      if (i >= 35 && d.getUTCMonth() !== first.getUTCMonth()) break;
      out.push(d);
    }
    return out;
  }, [view]);
  const step = (n) => setView((v) => new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + n, 1, 12)));

  // Repetición semanal → fechas nuevas que se suman a las elegidas.
  const generated = useMemo(() => {
    if (!repeat.days.length || !repeat.from || !repeat.to || repeat.to < repeat.from) return [];
    const out = [];
    for (let d = parse(repeat.from); fmt(d) <= repeat.to && out.length < max; d = addDays(d, 1)) {
      if (repeat.days.includes(isoIndex(d))) out.push(fmt(d));
    }
    return out;
  }, [repeat, max]);
  const addGenerated = () => {
    const next = new Set(selected);
    generated.forEach((d) => next.add(d));
    commit(next);
    setRepeat((r) => ({ ...r, days: [] }));
  };

  const byMonth = useMemo(() => {
    const map = new Map();
    sorted.forEach((s) => {
      const d = parse(s);
      const key = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map.entries()];
  }, [sorted]);
  const today = todayStr();
  const upcoming = sorted.filter((d) => d >= today).length;

  return (
    <div className={`mdp ${disabled ? 'is-disabled' : ''}`}>
      <div className="mdp__bar">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={disabled}>
          <Icon name="calendar" size={15} /> {open ? 'Cerrar calendario' : sorted.length ? 'Agregar o quitar fechas' : 'Elegir fechas'}
        </button>
        <span className="mdp__count">
          {sorted.length ? (
            <>
              <strong>{sorted.length}</strong> fecha{sorted.length === 1 ? '' : 's'}
              {sorted.length !== upcoming && ` · ${upcoming} por venir`}
            </>
          ) : (
            'Ninguna fecha elegida'
          )}
        </span>
        {sorted.length > 0 && !disabled && (
          <button type="button" className="link-button mdp__clear" onClick={() => onChange([])}>
            Quitar todas
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="mdp__panel">
          <div className="mdp__calendar">
            <div className="mdp__head">
              <button type="button" className="mdp__nav" onClick={() => step(-1)} aria-label="Mes anterior">
                <Icon name="chevronLeft" size={16} />
              </button>
              <strong className="mdp__month">
                {MONTHS[view.getUTCMonth()]} {view.getUTCFullYear()}
              </strong>
              <button type="button" className="mdp__nav" onClick={() => step(1)} aria-label="Mes siguiente">
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
            <div className="mdp__grid" role="grid" aria-label="Calendario: toca un día para marcarlo o desmarcarlo">
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="mdp__weekday" title={WEEKDAY_NAMES[i]}>
                  {w}
                </span>
              ))}
              {cells.map((d) => {
                const s = fmt(d);
                const on = selected.has(s);
                const outside = d.getUTCMonth() !== view.getUTCMonth();
                return (
                  <button
                    key={s}
                    type="button"
                    role="gridcell"
                    aria-pressed={on}
                    aria-label={`${WEEKDAY_NAMES[isoIndex(d)]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`}
                    className={`mdp__day ${on ? 'is-on' : ''} ${outside ? 'is-outside' : ''} ${s === today ? 'is-today' : ''} ${isoIndex(d) > 4 ? 'is-weekend' : ''}`}
                    onClick={() => toggle(s)}
                  >
                    {d.getUTCDate()}
                  </button>
                );
              })}
            </div>
            <p className="form-hint">Toca un día para marcarlo; tócalo otra vez para quitarlo.</p>
          </div>

          <div className="mdp__repeat">
            <span className="student-card__label">Repetir cada semana</span>
            <div className="mdp__weekdays" role="group" aria-label="Días de la semana">
              {WEEKDAY_NAMES.map((name, i) => {
                const on = repeat.days.includes(i);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    className={`mdp__wd ${on ? 'is-on' : ''}`}
                    onClick={() => setRepeat((r) => ({ ...r, days: on ? r.days.filter((x) => x !== i) : [...r.days, i] }))}
                    title={name}
                  >
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <div className="mdp__range">
              <label>
                Desde
                <input type="date" className="input" value={repeat.from} onChange={(e) => setRepeat((r) => ({ ...r, from: e.target.value }))} />
              </label>
              <label>
                Hasta
                <input type="date" className="input" value={repeat.to} min={repeat.from} onChange={(e) => setRepeat((r) => ({ ...r, to: e.target.value }))} />
              </label>
            </div>
            <button type="button" className="btn btn--primary btn--sm" onClick={addGenerated} disabled={!generated.length}>
              <Icon name="plus" size={14} /> Agregar {generated.length || ''} fecha{generated.length === 1 ? '' : 's'}
            </button>
            <p className="form-hint">Ej.: martes y jueves del 15/10 al 18/12. Luego puedes quitar feriados tocándolos.</p>
          </div>
        </div>
      )}

      {byMonth.length > 0 && (
        <div className="mdp__chips">
          {byMonth.map(([month, dates]) => (
            <div key={month} className="mdp__chip-group">
              <span className="mdp__chip-month">{month}</span>
              <div className="chip-list">
                {dates.map((d) => (
                  <span key={d} className={`mdp__chip ${d < today ? 'is-past' : ''}`}>
                    {chipLabel(d)}
                    {!disabled && (
                      <button type="button" onClick={() => remove(d)} aria-label={`Quitar ${chipLabel(d)}`} title="Quitar">
                        <Icon name="x" size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MultiDatePicker;
