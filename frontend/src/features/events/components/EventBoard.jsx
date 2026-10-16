import { useMemo, useState } from 'react';
import Icon from '../../../components/ui/Icon';
import { EVENT_CATEGORIES, MONTHS, categoryOf, dateParts, excerpt, parseDay, timeLabel, todayStr } from '../eventCatalog';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const monthStart = (s) => {
  const d = parseDay(s);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12));
};
const mondayOf = (s) => {
  const d = parseDay(s);
  return addDays(d, -((d.getUTCDay() + 6) % 7));
};
const byTime = (a, b) => a.start_time.localeCompare(b.start_time) || a.title.localeCompare(b.title);

// La vista elegida se recuerda en este navegador (si el almacenamiento no está disponible, no pasa nada).
const VIEW_KEY = 'events.view';
const readView = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) || 'null');
    return v && ['cards', 'schedule'].includes(v.view) && ['week', 'month'].includes(v.scale) ? v : null;
  } catch {
    return null;
  }
};
const saveView = (v) => {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // sin almacenamiento: la vista vuelve a la predeterminada la próxima vez
  }
};

/**
 * Cartelera de eventos con DOS vistas intercambiables:
 *   - Tarjetas: cuadrícula con la categoría (color), fecha, hora, título y un
 *     extracto de la descripción. Los próximos primero; los pasados, aparte.
 *   - Horario: agenda en el tiempo, por SEMANA (columnas lunes a domingo con
 *     los eventos en orden de hora) o por MES (calendario).
 * Filtro por tipo de evento. La comparten la administración y el portal del
 * representante, así que ambos ven exactamente lo mismo.
 *
 *   events    lista de la API (event_date, start_time, end_time, is_past…)
 *   onSelect  (evento) => void — abre el detalle
 *   empty     contenido cuando no hay eventos
 */
function EventBoard({ events = [], onSelect, empty }) {
  const [mode, setMode] = useState(() => readView() || { view: 'cards', scale: 'week' });
  const [category, setCategory] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [anchor, setAnchor] = useState(todayStr);
  const change = (patch) =>
    setMode((m) => {
      const next = { ...m, ...patch };
      saveView(next);
      return next;
    });

  const filtered = useMemo(() => events.filter((e) => !category || e.category === category), [events, category]);
  const counts = useMemo(() => {
    const c = {};
    events.forEach((e) => {
      c[e.category] = (c[e.category] || 0) + 1;
    });
    return c;
  }, [events]);

  if (!events.length) return empty;

  return (
    <div className="evt-board">
      <div className="evt-board__toolbar">
        <div className="segmented evt-board__views" role="tablist" aria-label="Vista de la cartelera">
          {[
            ['cards', 'Tarjetas', 'layers'],
            ['schedule', 'Horario', 'calendar'],
          ].map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode.view === key}
              className={`segmented__item ${mode.view === key ? 'segmented__item--active' : ''}`}
              onClick={() => change({ view: key })}
            >
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="evt-board__filters" role="group" aria-label="Filtrar por tipo">
          <button type="button" className={`evt-filter evt-filter--all ${!category ? 'is-on' : ''}`} onClick={() => setCategory('')} aria-pressed={!category}>
            Todos <span className="evt-filter__count">{events.length}</span>
          </button>
          {Object.entries(EVENT_CATEGORIES)
            .filter(([key]) => counts[key])
            .map(([key, cat]) => (
              <button
                key={key}
                type="button"
                className={`evt-filter evt--${key} ${category === key ? 'is-on' : ''}`}
                onClick={() => setCategory(category === key ? '' : key)}
                aria-pressed={category === key}
              >
                <Icon name={cat.icon} size={13} /> {cat.label} <span className="evt-filter__count">{counts[key]}</span>
              </button>
            ))}
        </div>
      </div>

      {mode.view === 'cards' ? (
        <CardsView events={filtered} onSelect={onSelect} showPast={showPast} setShowPast={setShowPast} filtered={Boolean(category)} />
      ) : (
        <ScheduleView events={filtered} scale={mode.scale} setScale={(scale) => change({ scale })} anchor={anchor} setAnchor={setAnchor} onSelect={onSelect} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista de tarjetas
// ---------------------------------------------------------------------------

function CardsView({ events, onSelect, showPast, setShowPast, filtered }) {
  const upcoming = events.filter((e) => !e.is_past);
  const past = events.filter((e) => e.is_past);
  return (
    <>
      {upcoming.length ? <CardGrid events={upcoming} onSelect={onSelect} /> : <p className="text-muted evt-board__none">No hay eventos próximos{filtered ? ' de este tipo' : ''}.</p>}
      {past.length > 0 && (
        <div className="evt-board__past">
          <button type="button" className="link-button" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
            <Icon name={showPast ? 'chevronDown' : 'chevronRight'} size={14} /> {showPast ? 'Ocultar' : 'Ver'} eventos anteriores ({past.length})
          </button>
          {showPast && <CardGrid events={past} onSelect={onSelect} />}
        </div>
      )}
    </>
  );
}

/** Tarjetas agrupadas por mes. */
function CardGrid({ events, onSelect }) {
  const groups = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      const d = parseDay(ev.event_date);
      const key = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
    return [...map.entries()];
  }, [events]);

  return groups.map(([month, list]) => (
    <section key={month} className="evt-month">
      <h3 className="evt-month__title">{month}</h3>
      <div className="evt-grid">
        {list.map((ev) => (
          <EventCard key={ev.id} ev={ev} onSelect={onSelect} />
        ))}
      </div>
    </section>
  ));
}

function EventCard({ ev, onSelect }) {
  const cat = categoryOf(ev.category);
  const parts = dateParts(ev.event_date);
  const summary = excerpt(ev.description);
  return (
    <button type="button" className={`evt-card evt--${ev.category} ${ev.is_past ? 'is-past' : ''}`} onClick={() => onSelect(ev)}>
      <span className="evt-card__top">
        <span className="evt-tag">
          <Icon name={cat.icon} size={12} /> {cat.label}
        </span>
        {!ev.is_published && <span className="chip">Borrador</span>}
        {ev.event_date === todayStr() && <span className="chip evt-card__today">Hoy</span>}
      </span>
      <span className="evt-card__main">
        <span className="evt-card__date" aria-hidden="true">
          <span className="evt-card__weekday">{parts.weekday}</span>
          <span className="evt-card__day">{parts.day}</span>
          <span className="evt-card__month">{parts.month}</span>
        </span>
        <span className="evt-card__body">
          <strong className="evt-card__title">{ev.title}</strong>
          <span className="evt-card__time">
            <Icon name="clock" size={13} /> {timeLabel(ev)}
          </span>
        </span>
      </span>
      {summary && <span className="evt-card__excerpt">{summary}</span>}
      <span className="evt-card__meta">
        {ev.location && (
          <span>
            <Icon name="building" size={13} /> {ev.location}
          </span>
        )}
        <span>
          <Icon name="users" size={13} /> {ev.audience_label}
          {ev.for_students?.length ? ` (${ev.for_students.join(', ')})` : ''}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Vista de horario (semana / mes)
// ---------------------------------------------------------------------------

function ScheduleView({ events, scale, setScale, anchor, setAnchor, onSelect }) {
  const today = todayStr();
  const byDay = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => {
      if (!map.has(ev.event_date)) map.set(ev.event_date, []);
      map.get(ev.event_date).push(ev);
    });
    map.forEach((list) => list.sort(byTime));
    return map;
  }, [events]);

  const step = (n) => {
    if (scale === 'week') return setAnchor(fmt(addDays(parseDay(anchor), n * 7)));
    const m = monthStart(anchor);
    return setAnchor(fmt(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + n, 1, 12))));
  };
  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  const label =
    scale === 'week'
      ? `${monday.getUTCDate()}${monday.getUTCMonth() !== sunday.getUTCMonth() ? ` ${MONTHS[monday.getUTCMonth()].slice(0, 3)}` : ''} – ${sunday.getUTCDate()} ${MONTHS[sunday.getUTCMonth()]} ${sunday.getUTCFullYear()}`
      : `${MONTHS[monthStart(anchor).getUTCMonth()]} ${monthStart(anchor).getUTCFullYear()}`;
  // Salto rápido al próximo evento cuando el período visible está vacío.
  const nextEvent = events.find((e) => e.event_date >= today);

  return (
    <div className="evt-sched">
      <div className="evt-sched__nav">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => step(-1)} aria-label={scale === 'week' ? 'Semana anterior' : 'Mes anterior'}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <strong className="evt-sched__label">{label}</strong>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => step(1)} aria-label={scale === 'week' ? 'Semana siguiente' : 'Mes siguiente'}>
          <Icon name="chevronRight" size={16} />
        </button>
        <button type="button" className="link-button" onClick={() => setAnchor(today)}>
          Hoy
        </button>
        <div className="segmented segmented--sm evt-sched__scale" role="tablist" aria-label="Escala">
          {[
            ['week', 'Semana'],
            ['month', 'Mes'],
          ].map(([key, text]) => (
            <button key={key} type="button" role="tab" aria-selected={scale === key} className={`segmented__item ${scale === key ? 'segmented__item--active' : ''}`} onClick={() => setScale(key)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {scale === 'week' ? (
        <WeekView monday={monday} byDay={byDay} today={today} onSelect={onSelect} nextEvent={nextEvent} onJump={setAnchor} />
      ) : (
        <MonthView anchor={monthStart(anchor)} byDay={byDay} today={today} onSelect={onSelect} onPickDay={(d) => {
            setAnchor(d);
            setScale('week');
          }}
        />
      )}
    </div>
  );
}

/** Semana: una columna por día (lunes a domingo) con sus eventos en orden de hora. */
function WeekView({ monday, byDay, today, onSelect, nextEvent, onJump }) {
  const days = Array.from({ length: 7 }, (_, i) => fmt(addDays(monday, i)));
  const total = days.reduce((n, d) => n + (byDay.get(d)?.length || 0), 0);
  return (
    <>
      <div className="evt-week" role="grid" aria-label="Eventos de la semana">
        {days.map((date, i) => {
          const list = byDay.get(date) || [];
          const d = parseDay(date);
          return (
            <div key={date} role="gridcell" className={`evt-week__day ${date === today ? 'is-today' : ''} ${date < today ? 'is-past' : ''} ${i > 4 ? 'is-weekend' : ''} ${list.length ? '' : 'is-empty'}`}>
              <div className="evt-week__head">
                <span className="evt-week__weekday">{WEEKDAYS[i]}</span>
                <span className="evt-week__date">{d.getUTCDate()}</span>
              </div>
              <div className="evt-week__events">
                {list.map((ev) => (
                  <button key={ev.id} type="button" className={`evt-block evt--${ev.category} ${ev.is_published ? '' : 'is-draft'}`} onClick={() => onSelect(ev)}>
                    <span className="evt-block__time">{timeLabel(ev)}</span>
                    <span className="evt-block__title">{ev.title}</span>
                    {ev.location && <span className="evt-block__place">{ev.location}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {total === 0 && (
        <p className="text-muted evt-board__none">
          Sin eventos esta semana.
          {nextEvent && nextEvent.event_date > days[6] && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={() => onJump(nextEvent.event_date)}>
                Ir al próximo: {nextEvent.title} ({dateParts(nextEvent.event_date).day} {dateParts(nextEvent.event_date).month})
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}

/** Mes: calendario lunes a domingo; al tocar el número del día se abre esa semana. */
function MonthView({ anchor, byDay, today, onSelect, onPickDay }) {
  const cells = useMemo(() => {
    const start = addDays(anchor, -((anchor.getUTCDay() + 6) % 7));
    const out = [];
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(start, i);
      if (i % 7 === 0 && i >= 28 && d.getUTCMonth() !== anchor.getUTCMonth()) break;
      out.push(d);
    }
    return out;
  }, [anchor]);

  return (
    <div className="evt-cal__grid" role="grid" aria-label="Calendario mensual de eventos">
      {WEEKDAYS.map((w) => (
        <div key={w} className="evt-cal__weekday" role="columnheader">
          {w}
        </div>
      ))}
      {cells.map((d) => {
        const date = fmt(d);
        const list = byDay.get(date) || [];
        return (
          <div
            key={date}
            role="gridcell"
            className={`evt-cal__day ${d.getUTCMonth() !== anchor.getUTCMonth() ? 'is-outside' : ''} ${date === today ? 'is-today' : ''} ${date < today ? 'is-past' : ''}`}
          >
            <button type="button" className="evt-cal__date" onClick={() => onPickDay(date)} title="Ver esa semana">
              {d.getUTCDate()}
            </button>
            {list.slice(0, 3).map((ev) => (
              <button key={ev.id} type="button" className={`evt-pill evt--${ev.category} ${ev.is_published ? '' : 'is-draft'}`} onClick={() => onSelect(ev)} title={`${ev.title} · ${timeLabel(ev)}`}>
                <span className="evt-pill__time">{ev.start_time}</span>
                <span className="evt-pill__title">{ev.title}</span>
              </button>
            ))}
            {list.length > 3 && (
              <button type="button" className="link-button evt-cal__more" onClick={() => onPickDay(date)}>
                +{list.length - 3} más
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default EventBoard;
