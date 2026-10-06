import { useEffect, useMemo, useState } from 'react';
import schedulesApi from '../../../api/endpoints/schedules.api';
import academicsApi from '../../../api/endpoints/academics.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import ScheduleGrid, { hueOf } from '../components/ScheduleGrid';
import SlotsEditorModal from '../components/SlotsEditorModal';

/**
 * Horarios por sección (administración).
 *
 *   - Arrastra una materia del banco (o una clase ya colocada) y suéltala en
 *     una celda; o tócala y luego toca la celda (pantallas táctiles).
 *   - Mientras se arrastra, las celdas en que el profesor de esa materia ya da
 *     clase en otra sección se marcan en rojo y no aceptan la materia.
 *   - El backend vuelve a validar (celda libre, sin cruce del docente) y
 *     responde con el motivo si rechaza la clase.
 *   - Soltar una clase sobre el banco la quita del horario.
 */
function SchedulesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: periods } = useFetch(() => academicsApi.listSchoolPeriods(), []);
  const [periodId, setPeriodId] = useState('');
  const { data: sections, loading: loadingSections } = useFetch(
    () => (periodId ? schedulesApi.listSections({ schoolPeriodId: periodId }) : Promise.resolve([])),
    [periodId],
  );
  const [sectionId, setSectionId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(null); // { subjectId, teacher, entryId? }
  const [selected, setSelected] = useState(null); // modo tocar-y-colocar: lo mismo que dragging
  const [editingSlots, setEditingSlots] = useState(false);
  const [saving, setSaving] = useState(false);

  // Año por defecto: el activo más reciente.
  useEffect(() => {
    if (periodId || !periods?.length) return;
    const sorted = [...periods]
      .filter((p) => !p.closed_at)
      .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    setPeriodId((sorted.find((p) => p.is_active) || sorted[0] || periods[0]).id);
  }, [periods, periodId]);
  useEffect(() => setSectionId(''), [periodId]);

  const load = async (id = sectionId) => {
    if (!id) return setData(null);
    setLoading(true);
    setError(null);
    try {
      setData(await schedulesApi.getSection(id));
    } catch (err) {
      setError(getErrorMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load(sectionId);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const period = (periods || []).find((p) => p.id === periodId);
  const editable = Boolean(data && !data.read_only && can('schedules', 'update'));
  const active = dragging || selected; // lo que se está por colocar

  // Secciones agrupadas por grado para el selector.
  const byGrade = useMemo(() => {
    const map = new Map();
    (sections || []).forEach((s) => {
      if (!map.has(s.grade_id)) map.set(s.grade_id, { name: s.grade_name, list: [] });
      map.get(s.grade_id).list.push(s);
    });
    return [...map.values()];
  }, [sections]);

  /** Cruce: el profesor de lo que se coloca ya da clase en otra sección en ese día y bloque. */
  const conflictAt = (item, day, slot) => {
    if (!item?.teacher) return null;
    const busy = data?.teacher_busy?.[item.teacher.id]?.find((b) => b.day_of_week === day && b.time_slot_id === slot.id);
    return busy
      ? `Conflicto de horario: El profesor ${item.teacher.name} ya dicta clase en ${busy.where} a esta misma hora (${busy.subject_name}).`
      : null;
  };

  const cellState = (day, slot) => {
    if (!active) return {};
    const conflict = conflictAt(active, day, slot);
    const occupied = data.entries.some((e) => e.day_of_week === day && e.time_slot_id === slot.id && e.id !== active.entryId);
    return { conflict, droppable: !conflict && !occupied };
  };

  const placeAt = async (item, day, slot) => {
    const conflict = conflictAt(item, day, slot);
    if (conflict) {
      toast.error('No se puede colocar', conflict);
      return;
    }
    setSaving(true);
    try {
      if (item.entryId) await schedulesApi.move(item.entryId, { dayOfWeek: day, timeSlotId: slot.id });
      else await schedulesApi.place(sectionId, { subjectId: item.subjectId, dayOfWeek: day, timeSlotId: slot.id });
      await load();
    } catch (err) {
      toast.error('No se puede colocar', getErrorMessage(err));
    } finally {
      setSaving(false);
      setSelected(null);
    }
  };

  const remove = async (entry) => {
    try {
      await schedulesApi.remove(entry.id);
      toast.success('Clase quitada', `${entry.subject_name}`);
      await load();
    } catch (err) {
      toast.error('No se pudo quitar', getErrorMessage(err));
    }
  };

  const itemOfEntry = (e) => ({
    entryId: e.id,
    subjectId: e.subject_id,
    teacher: { id: e.staff_id, name: e.teacher_name },
    name: e.subject_name,
  });
  const itemOfSubject = (b) => ({ subjectId: b.subject_id, teacher: b.teacher, name: b.subject_name });

  const totalPlaced = data?.entries?.length || 0;
  const freeCells = data ? data.slots.filter((s) => !s.is_break).length * data.days.length : 0;

  return (
    <div>
      <PageHeader
        title="Horarios"
        subtitle="Arma el horario semanal de cada sección. El sistema impide que un profesor tenga dos clases a la misma hora."
        actions={
          can('schedules', 'update') &&
          period &&
          !period.closed_at && (
            <Button variant="secondary" icon="clock" onClick={() => setEditingSlots(true)}>
              Bloques horarios
            </Button>
          )
        }
      />

      <Card>
        <div className="promotion-filters">
          <label>
            <span className="student-card__label">Año escolar</span>
            <Select sorted value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {(periods || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.closed_at ? ' (finalizado)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ minWidth: 240 }}>
            <span className="student-card__label">Grado y sección</span>
            <Select sorted value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={loadingSections}>
              <option value="">Selecciona…</option>
              {byGrade.map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.grade_name} · Sección {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Alert>{error}</Alert>
      {loading && <Spinner label="Cargando horario…" />}

      {!sectionId && !loading && <p className="text-muted">Elige un grado y sección para ver o armar su horario.</p>}

      {data && !loading && data.slots.length === 0 && (
        <Card>
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="clock" size={24} />
            </div>
            <div className="empty-state__title">El año {data.section.school_period_name} aún no tiene bloques horarios</div>
            <div className="text-sm">Define las horas de clase (por ejemplo 07:00–07:45) para todas las secciones del año.</div>
            {can('schedules', 'update') && (
              <Button icon="clock" onClick={() => setEditingSlots(true)} style={{ marginTop: 12 }}>
                Configurar bloques horarios
              </Button>
            )}
          </div>
        </Card>
      )}

      {data && !loading && data.slots.length > 0 && (
        <div className={`schedule-board ${editable ? '' : 'is-readonly'}`}>
          {editable && (
            <aside
              className={`schedule-bank ${dragging?.entryId ? 'is-drop-remove' : ''}`}
              onDragOver={(e) => dragging?.entryId && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const entry = dragging?.entryId && data.entries.find((x) => x.id === dragging.entryId);
                setDragging(null);
                if (entry) remove(entry);
              }}
            >
              <div className="schedule-bank__head">
                <strong>
                  Materias de {data.section.grade_name} {data.section.name}
                </strong>
                <span className="text-sm text-muted">Arrastra a la grilla, o tócala y luego toca la celda.</span>
              </div>
              {data.bank.length === 0 && (
                <p className="text-sm text-muted">El grado no tiene plan de estudios: agrégale materias en Grados y secciones.</p>
              )}
              <ul className="schedule-bank__list">
                {data.bank.map((b) => {
                  const done = b.weekly_hours && b.placed >= b.weekly_hours;
                  const isSelected = selected && !selected.entryId && selected.subjectId === b.subject_id;
                  return (
                    <li
                      key={b.subject_id}
                      className={`schedule-bank__item ${b.teacher ? '' : 'is-disabled'} ${isSelected ? 'is-selected' : ''} ${done ? 'is-done' : ''}`}
                      style={{ '--entry-hue': hueOf(b.subject_id) }}
                      draggable={Boolean(b.teacher)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', b.subject_id);
                        setDragging(itemOfSubject(b));
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      {/* div (no <button>): Firefox no inicia el arrastre desde un botón. */}
                      <div
                        role="button"
                        tabIndex={b.teacher ? 0 : -1}
                        className="schedule-bank__card"
                        aria-disabled={!b.teacher}
                        aria-pressed={isSelected}
                        onClick={() => b.teacher && setSelected(isSelected ? null : itemOfSubject(b))}
                        onKeyDown={(e) => {
                          if (b.teacher && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            setSelected(isSelected ? null : itemOfSubject(b));
                          }
                        }}
                        title={b.teacher ? 'Arrástrala a la grilla, o tócala y luego toca la celda' : 'Asigna un profesor en la carga docente'}
                      >
                        <span className="schedule-bank__name">{b.subject_name}</span>
                        <span className="schedule-bank__teacher">{b.teacher ? b.teacher.name : 'Sin profesor asignado'}</span>
                        <span className={`schedule-bank__hours ${done ? 'is-done' : ''}`}>
                          {b.placed}
                          {b.weekly_hours ? ` / ${b.weekly_hours}` : ''} h
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {dragging?.entryId && (
                <div className="schedule-bank__drop">
                  <Icon name="trash" size={16} /> Suelta aquí para quitarla del horario
                </div>
              )}
              <p className="text-sm text-muted schedule-bank__summary">
                {totalPlaced} de {freeCells} horas de la semana ocupadas.
              </p>
            </aside>
          )}

          <div className="schedule-main">
            {selected && (
              <Alert variant="info">
                Toca la celda donde va <strong>{selected.name}</strong> ({selected.teacher?.name}). Las celdas en rojo son horas en que el
                profesor ya tiene clase.{' '}
                <button type="button" className="link-button" onClick={() => setSelected(null)}>
                  Cancelar
                </button>
              </Alert>
            )}
            {data.read_only && (
              <Alert variant="info">
                Horario de solo lectura
                {data.section.period_closed_at ? `: el año ${data.section.school_period_name} está finalizado.` : '.'}
              </Alert>
            )}
            <ScheduleGrid
              days={data.days}
              slots={data.slots}
              entries={data.entries}
              editable={editable && !saving}
              cellState={cellState}
              colorOf={(e) => hueOf(e.subject_id)}
              onCellDrop={(day, slot) => {
                const item = dragging;
                setDragging(null);
                if (item) placeAt(item, day, slot);
              }}
              onCellClick={(day, slot) => {
                if (selected) placeAt(selected, day, slot);
              }}
              onEntryDragStart={(e) => setDragging(itemOfEntry(e))}
              onEntryDragEnd={() => setDragging(null)}
              onEntryRemove={remove}
            />
            {saving && <Spinner label="Guardando…" />}
          </div>
        </div>
      )}

      {editingSlots && period && <SlotsEditorModal period={period} onClose={() => setEditingSlots(false)} onSaved={() => load()} />}
    </div>
  );
}

export default SchedulesPage;
