import { useEffect, useMemo, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import ScheduleGrid, { hueOf } from './ScheduleGrid';
import EvaluationDetailModal, { EVAL_STATUS } from './EvaluationDetailModal';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Fechas como 'YYYY-MM-DD' en UTC (sin corrimientos de zona horaria).
const parse = (d) => new Date(`${d}T12:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));
const short = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/**
 * Horario de EVALUACIONES de una sección, sincronizado automáticamente con
 * los planes de evaluación (fechas) y con el horario de clases (hora: el
 * bloque en que la sección tiene esa materia ese día). Nada se carga a mano:
 * para mover una evaluación se cambia su fecha en el plan.
 *
 *   - Vista mensual: un calendario lunes a viernes con las evaluaciones de
 *     cada día; los días sobrecargados (2+ pesadas o 3+ evaluaciones) en rojo.
 *   - Vista semanal: la grilla de bloques horarios con cada evaluación en su hora.
 *   - Resumen: programadas, pesadas, días cargados, sin fecha y sin bloque.
 *   - Al hacer clic en una evaluación se abre su detalle (EvaluationDetailModal).
 */
/**
 * `fetcher` / `fetchKey` (opcionales): de dónde cargar el cronograma. Por
 * defecto, el de la sección (administración/docentes); el portal del
 * representante pasa el de su alumno (GET /portal/students/:id/evaluations).
 */
function EvaluationCalendar({ sectionId, termNumber, fetcher, fetchKey }) {
  const { data, loading, error } = useFetch(
    () => (fetcher ? fetcher() : schedulesApi.getEvaluations(sectionId, termNumber)),
    [fetchKey ?? sectionId, termNumber],
  );
  const [mode, setMode] = useState('month'); // 'month' | 'week'
  const [anchor, setAnchor] = useState(null); // fecha de referencia (mes o semana mostrados)
  const [showUndated, setShowUndated] = useState(false);
  const [selectedId, setSelectedId] = useState(null); // evaluación abierta en el modal de detalle

  // Al cargar: el mes/semana de hoy si cae en el lapso; si no, el de la primera evaluación o el inicio del lapso.
  useEffect(() => {
    if (!data?.summary) return; // sin sección (alumno no inscrito): nada que ubicar
    const { from, to } = data.summary;
    const today = todayStr();
    const inRange = from && to && today >= from && today <= to;
    setAnchor(inRange ? today : data.evaluations[0]?.date || from || today);
  }, [data]);

  const byDate = useMemo(() => {
    const map = new Map();
    (data?.evaluations || []).forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    });
    return map;
  }, [data]);
  const dayInfo = useMemo(() => new Map((data?.days || []).map((d) => [d.date, d])), [data]);

  if (loading) return <Spinner label="Sincronizando con los planes de evaluación…" />;
  if (error) return <Alert>{error}</Alert>;
  if (data && !data.section) {
    return <p className="text-muted">El alumno no está inscrito en una sección este año: aún no hay evaluaciones que mostrar.</p>;
  }
  if (!data || !anchor) return null;

  const { summary } = data;
  const select = (e) => setSelectedId(e.activity_id);
  const selected = selectedId ? [...data.evaluations, ...data.undated].find((x) => x.activity_id === selectedId) : null;
  const from = summary.from;
  const to = summary.to;
  const inTerm = (d) => (!from || d >= from) && (!to || d <= to);
  const a = parse(anchor);

  // ---- Navegación ----
  const step = (dir) => {
    if (mode === 'month') setAnchor(fmt(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + dir, 1, 12))));
    else setAnchor(fmt(addDays(a, 7 * dir)));
  };
  const label =
    mode === 'month'
      ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`
      : `Semana del ${short(mondayOf(a))} al ${short(addDays(mondayOf(a), 4))}`;

  return (
    <div className="evalcal">
      {/* Resumen */}
      <div className="evalcal__stats">
        <span className="evalcal__stat">
          <strong>{summary.scheduled}</strong> programada{summary.scheduled === 1 ? '' : 's'}
        </span>
        <span className="evalcal__stat">
          <span className="evalcal__heavy-dot" /> <strong>{summary.heavy}</strong> pesada{summary.heavy === 1 ? '' : 's'}
        </span>
        <span className={`evalcal__stat ${summary.overloaded_days.length ? 'evalcal__stat--danger' : 'evalcal__stat--ok'}`}>
          <Icon name={summary.overloaded_days.length ? 'alertTriangle' : 'checkCircle'} size={14} />
          <strong>{summary.overloaded_days.length}</strong> día{summary.overloaded_days.length === 1 ? '' : 's'} cargado{summary.overloaded_days.length === 1 ? '' : 's'}
        </span>
        {summary.undated > 0 && (
          <button type="button" className="evalcal__stat evalcal__stat--warn" onClick={() => setShowUndated((v) => !v)} aria-expanded={showUndated}>
            <Icon name="calendar" size={14} /> <strong>{summary.undated}</strong> sin fecha
          </button>
        )}
        {summary.without_block > 0 && (
          <span className="evalcal__stat evalcal__stat--warn" title="La materia no tiene clase ese día en el horario: la evaluación queda sin hora.">
            <Icon name="clock" size={14} /> <strong>{summary.without_block}</strong> sin bloque horario
          </span>
        )}
      </div>

      {showUndated && summary.undated > 0 && (
        <Alert variant="warning">
          Estas evaluaciones no tienen fecha en su plan, así que no aparecen en el calendario. Asígnales una fecha desde el plan de evaluación:
          <ul className="evalcal__undated">
            {data.undated.map((e) => (
              <li key={e.activity_id}>
                <button type="button" className="link-button" onClick={() => select(e)}>
                  <strong>{e.subject_name}</strong> · {e.title}
                </button>{' '}
                ({e.category_label}, {e.weight_percent}%)
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card>
        <div className="evalcal__toolbar">
          <div className="evalcal__nav">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => step(-1)} aria-label="Anterior">
              <Icon name="chevronLeft" size={16} />
            </button>
            <strong className="evalcal__label">{label}</strong>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => step(1)} aria-label="Siguiente">
              <Icon name="chevronRight" size={16} />
            </button>
            <button type="button" className="link-button" onClick={() => setAnchor(todayStr())}>
              Hoy
            </button>
          </div>
          <div className="segmented" role="tablist" aria-label="Vista">
            {[
              ['month', 'Mensual'],
              ['week', 'Semanal'],
            ].map(([key, text]) => (
              <button key={key} type="button" role="tab" aria-selected={mode === key} className={`segmented__item ${mode === key ? 'segmented__item--active' : ''}`} onClick={() => setMode(key)}>
                {text}
              </button>
            ))}
          </div>
        </div>

        {mode === 'month' ? (
          <MonthView anchor={a} byDate={byDate} dayInfo={dayInfo} inTerm={inTerm} onSelect={select} onPickWeek={(d) => { setAnchor(d); setMode('week'); }} />
        ) : (
          <WeekView monday={mondayOf(a)} byDate={byDate} dayInfo={dayInfo} slots={data.slots} inTerm={inTerm} onSelect={select} />
        )}

        <p className="form-hint evalcal__legend">
          <span className="evalcal__heavy-dot" /> Pesada: examen, proyecto o {data.rules.heavy_weight}% o más del lapso. En rojo, los días cargados (
          {data.rules.overloaded.heavy}+ pesadas o {data.rules.overloaded.total}+ evaluaciones). Las fechas vienen de los planes de evaluación y la
          hora, del horario de clases de la sección. Toca una evaluación para ver su detalle.
        </p>
      </Card>

      {selected && <EvaluationDetailModal evaluation={selected} section={data.section} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

/** Tarjeta de una evaluación (materia, hora, título y peso): al hacer clic abre su detalle. */
function EvalChip({ e, compact = false, onSelect }) {
  const status = EVAL_STATUS[e.status];
  return (
    <button
      type="button"
      className={`evalcal__chip evalcal__chip--${e.status} ${e.heavy ? 'is-heavy' : ''}`}
      style={{ '--entry-hue': hueOf(e.subject_id || e.subject_name) }}
      onClick={() => onSelect?.(e)}
      aria-label={`${e.subject_name}: ${e.title}${status ? ` (${status.label})` : ''}. Ver detalle`}
    >
      <span className="evalcal__chip-head">
        {e.start_time && <span className="evalcal__time">{e.start_time}</span>}
        <strong>{e.subject_code || e.subject_name}</strong>
        {e.heavy && <span className="evalcal__heavy-dot" aria-label="Pesada" />}
      </span>
      {!compact && (
        <span className="evalcal__chip-sub">
          {e.title} · {e.weight_percent}%
        </span>
      )}
      {e.status === 'graded' && <Icon name="checkCircle" size={11} className="evalcal__chip-check" />}
    </button>
  );
}

function MonthView({ anchor, byDate, dayInfo, inTerm, onPickWeek, onSelect }) {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
  const month = first.getUTCMonth();
  const weeks = [];
  // Si el 1 cae sábado o domingo, la primera semana del mes empieza el lunes siguiente.
  const dow = first.getUTCDay();
  const start = dow === 6 ? addDays(first, 2) : dow === 0 ? addDays(first, 1) : mondayOf(first);
  for (let w = start; w.getUTCMonth() === month || w < first; w = addDays(w, 7)) {
    weeks.push([0, 1, 2, 3, 4].map((i) => addDays(w, i)));
    if (weeks.length > 6) break;
  }
  return (
    <div className="evalcal__month" role="grid" aria-label="Calendario mensual de evaluaciones">
      {WEEKDAYS.map((d) => (
        <div key={d} className="evalcal__weekday" role="columnheader">
          {d}
        </div>
      ))}
      {weeks.flat().map((d) => {
        const date = fmt(d);
        const list = byDate.get(date) || [];
        const info = dayInfo.get(date);
        const outside = d.getUTCMonth() !== month;
        return (
          <div
            key={date}
            role="gridcell"
            className={`evalcal__day ${outside ? 'is-outside' : ''} ${!inTerm(date) ? 'is-off-term' : ''} ${info?.overloaded ? 'is-overloaded' : ''} ${date === todayStr() ? 'is-today' : ''}`}
          >
            <button type="button" className="evalcal__date" onClick={() => onPickWeek(date)} title="Ver la semana">
              {d.getUTCDate()}
              {info?.overloaded && <span className="evalcal__flag">Cargado</span>}
            </button>
            {list.slice(0, 4).map((e) => (
              <EvalChip key={e.activity_id} e={e} compact onSelect={onSelect} />
            ))}
            {list.length > 4 && <span className="evalcal__more">+{list.length - 4} más</span>}
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ monday, byDate, dayInfo, slots, inTerm, onSelect }) {
  const dates = [0, 1, 2, 3, 4].map((i) => fmt(addDays(monday, i)));
  const week = dates.flatMap((d) => byDate.get(d) || []);
  const placed = week.filter((e) => e.time_slot_id);
  const unplaced = week.filter((e) => !e.time_slot_id);
  const days = dates.map((d, i) => ({
    day: i + 1,
    name: `${WEEKDAYS[i]} ${short(parse(d))}${dayInfo.get(d)?.overloaded ? ' · cargado' : ''}${inTerm(d) ? '' : ' (fuera del lapso)'}`,
  }));

  return (
    <div className="evalcal__week">
      {unplaced.length > 0 && (
        <div className="evalcal__unplaced">
          <span className="student-card__label">Sin bloque horario (la materia no tiene clase ese día)</span>
          <div className="evalcal__unplaced-list">
            {unplaced.map((e) => (
              <div key={e.activity_id} className="evalcal__unplaced-item">
                <span className="text-sm text-muted">{e.day_name}</span>
                <EvalChip e={e} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </div>
      )}
      {slots.length ? (
        <ScheduleGrid
          days={days}
          slots={slots}
          entries={placed.map((e) => ({ ...e, id: e.activity_id }))}
          colorOf={(e) => hueOf(e.subject_id || e.subject_name)}
          entryText={(e) => ({ title: `${e.subject_name}${e.heavy ? ' ●' : ''}`, sub: `${e.title} · ${e.weight_percent}%` })}
          cellHint={(day) => (dayInfo.get(dates[day - 1])?.overloaded ? { className: 'is-overloaded' } : null)}
          onEntryClick={(entry) => onSelect(entry)}
        />
      ) : (
        <p className="text-muted">El año aún no tiene bloques horarios: las evaluaciones se ven en la vista mensual.</p>
      )}
      {week.length === 0 && <p className="text-muted evalcal__empty">No hay evaluaciones programadas esta semana.</p>}
    </div>
  );
}

export default EvaluationCalendar;
