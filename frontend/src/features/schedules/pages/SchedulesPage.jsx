import { useEffect, useMemo, useRef, useState } from 'react';
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
import TeacherScheduleView from '../components/TeacherScheduleView';
import { blobErrorMessage, saveBlob } from '../../../utils/download';

/**
 * Año que se abre al entrar: el activo que contiene la fecha de hoy; si no
 * hay, el activo que empezó más recientemente (sin contar los que aún no
 * empiezan); si no, el más reciente.
 */
function defaultPeriod(periods) {
  const today = new Date().toISOString().slice(0, 10);
  const day = (d) => String(d || '').slice(0, 10);
  const open = periods.filter((p) => !p.closed_at).sort((a, b) => day(b.start_date).localeCompare(day(a.start_date)));
  return (
    open.find((p) => p.is_active && day(p.start_date) <= today && (!p.end_date || day(p.end_date) >= today)) ||
    open.find((p) => p.is_active && day(p.start_date) <= today) ||
    open.find((p) => p.is_active) ||
    open[0] ||
    periods[0]
  );
}

const VIEWS = [
  { key: 'section', label: 'Por grado / sección', icon: 'layers' },
  { key: 'teacher', label: 'Por docente', icon: 'user' },
];

/**
 * Horarios (administración). Dos formas de ver la grilla semanal:
 *
 *   - Por grado / sección: se elige grado y sección; se ve y se ARMA su
 *     horario (lo de abajo).
 *   - Por docente: se elige un profesor (A-Z) y se ve, en solo lectura, toda
 *     su semana en las distintas secciones, con huecos y carga por día. Al
 *     tocar una clase se abre su sección para editarla.
 *
 * Armado del horario de una sección:
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
  // TODOS los grados del colegio (jerarquía escolar), cada uno con sus secciones
  // en el año elegido. Se vuelve a pedir al cambiar de año.
  const {
    data: grades,
    loading: loadingGrades,
    refetch: refetchGrades,
  } = useFetch(() => (periodId ? schedulesApi.listGrades(periodId) : Promise.resolve([])), [periodId]);
  const [view, setView] = useState('section'); // 'section' (grado/sección) | 'teacher' (docente)
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const { data: teachers, loading: loadingTeachers } = useFetch(
    () => (periodId && view === 'teacher' ? schedulesApi.listTeachers(periodId) : Promise.resolve(null)),
    [periodId, view],
  );
  // Bloques del año: si no tiene, se avisa ANTES de elegir sección y se busca
  // otro año con bloques para ofrecer copiarlos.
  const { data: periodSlots, refetch: refetchPeriodSlots } = useFetch(
    () => (periodId ? schedulesApi.getSlots(periodId) : Promise.resolve(null)),
    [periodId],
  );
  const noSlots = Array.isArray(periodSlots) && periodSlots.length === 0;
  const { data: slotSource } = useFetch(async () => {
    if (!noSlots) return null;
    const others = (periods || []).filter((p) => p.id !== periodId).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    for (const p of others) {
      if ((await schedulesApi.getSlots(p.id)).length) return p;
    }
    return null;
  }, [noSlots, periodId, periods]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(null); // { subjectId, teacher, entryId? }
  const [selected, setSelected] = useState(null); // modo tocar-y-colocar: lo mismo que dragging
  const [editingSlots, setEditingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Año por defecto: el EN CURSO (el que contiene la fecha de hoy). Si hay
  // varios años activos (p. ej. ya se creó el próximo), no se abre el futuro,
  // que aún no tiene bloques ni clases.
  useEffect(() => {
    if (periodId || !periods?.length) return;
    setPeriodId(defaultPeriod(periods).id);
  }, [periods, periodId]);
  useEffect(() => {
    setGradeId('');
    setSectionId('');
    setTeacherId('');
  }, [periodId]);

  /** `silent`: recarga tras guardar sin ocultar la grilla (sin parpadeo). */
  const load = async (id = sectionId, { silent = false } = {}) => {
    if (!id) return setData(null);
    if (!silent) setLoading(true);
    setError(null);
    try {
      setData(await schedulesApi.getSection(id));
    } catch (err) {
      setError(getErrorMessage(err));
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  };
  const refresh = () => load(sectionId, { silent: true });
  useEffect(() => {
    load(sectionId);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const period = (periods || []).find((p) => p.id === periodId);
  const editable = Boolean(data && !data.read_only && can('schedules', 'update'));
  const active = dragging || selected; // lo que se está por colocar

  // Grados (con sus secciones del año) agrupados por nivel para el selector,
  // en el orden de la jerarquía escolar que ya trae el backend.
  const byGrade = useMemo(
    () => (grades || []).map((g) => ({ ...g, list: g.sections.map((s) => ({ ...s, grade_id: g.id, grade_name: g.name })) })),
    [grades],
  );
  const byLevel = useMemo(() => {
    const map = new Map();
    byGrade.forEach((g) => {
      if (!map.has(g.level_code)) map.set(g.level_code, { name: g.level_name, grades: [] });
      map.get(g.level_code).grades.push(g);
    });
    return [...map.values()];
  }, [byGrade]);
  const allSections = useMemo(() => byGrade.flatMap((g) => g.list), [byGrade]);
  const grade = byGrade.find((g) => g.id === gradeId);
  const gradeSections = grade?.list || [];

  const chooseGrade = (id) => {
    setGradeId(id);
    // Se abre de una vez la primera sección del grado (A); se cambia con el otro selector.
    setSectionId(byGrade.find((g) => g.id === id)?.list[0]?.id || '');
  };

  // Grado sin secciones en el año: se puede crear la primera desde aquí.
  const [creatingSection, setCreatingSection] = useState(false);
  const createFirstSection = async () => {
    setCreatingSection(true);
    try {
      const created = await academicsApi.createSection({ gradeId, schoolPeriodId: periodId, name: 'A' });
      toast.success('Sección creada', `${grade.name} · Sección A en ${period?.name}.`);
      await refetchGrades();
      setSectionId(created.id);
    } catch (err) {
      toast.error('No se pudo crear la sección', getErrorMessage(err));
    } finally {
      setCreatingSection(false);
    }
  };

  /** Desde la vista por docente: abrir (y poder editar) el horario de una de sus secciones. */
  const openSection = (id) => {
    const s = allSections.find((x) => x.id === id);
    if (!s) return;
    setGradeId(s.grade_id);
    setSectionId(s.id);
    setView('section');
  };

  /** Cruce: el profesor de lo que se coloca ya da clase en otra sección en ese día y bloque. */
  const conflictAt = (item, day, slot) => {
    if (!item?.teacher) return null;
    const busy = data?.teacher_busy?.[item.teacher.id]?.find((b) => b.day_of_week === day && b.time_slot_id === slot.id);
    return busy
      ? `Conflicto de horario: El profesor ${item.teacher.name} ya dicta clase en ${busy.where} a esta misma hora (${busy.subject_name}).`
      : null;
  };

  /** Clase que ya ocupa esa celda en la sección (sin contar la que se está moviendo). */
  const occupantAt = (item, day, slot) => data?.entries.find((e) => e.day_of_week === day && e.time_slot_id === slot.id && e.id !== item?.entryId);

  /**
   * Estado de cada celda mientras se arrastra:
   *   - rojo: el profesor ya tiene clase a esa hora en otra sección;
   *   - celda ocupada: se puede soltar igual → "Reemplazar" (desde el panel)
   *     o "Intercambiar" (al mover una clase ya puesta).
   */
  const cellState = (day, slot) => {
    if (!active) return {};
    const conflict = conflictAt(active, day, slot);
    if (conflict) return { conflict };
    if (active.entryId && active.day === day && active.slotId === slot.id) return {}; // su propia celda
    const occupant = occupantAt(active, day, slot);
    return { droppable: true, action: occupant ? (active.entryId ? 'swap' : 'replace') : null };
  };

  // Indicador de guardado (arriba de la grilla) y destello de las celdas guardadas.
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  const [flash, setFlash] = useState(() => new Set());
  const savedTimer = useRef(null);
  const markSaved = (cells) => {
    setSaveStatus('saved');
    setFlash(new Set(cells));
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => {
      setSaveStatus(null);
      setFlash(new Set());
    }, 2200);
  };
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /** Suelta (o toca) una materia/clase en una celda y la guarda en el backend al instante. */
  const placeAt = async (item, day, slot) => {
    const conflict = conflictAt(item, day, slot);
    if (conflict) {
      toast.error('No se puede colocar', conflict);
      return;
    }
    if (item.entryId && item.day === day && item.slotId === slot.id) return setSelected(null); // misma celda
    const occupant = occupantAt(item, day, slot);
    const onOccupied = occupant ? (item.entryId ? 'swap' : 'replace') : undefined;
    setSaving(true);
    setSaveStatus('saving');
    try {
      const saved = item.entryId
        ? await schedulesApi.move(item.entryId, { dayOfWeek: day, timeSlotId: slot.id, onOccupied })
        : await schedulesApi.place(sectionId, { subjectId: item.subjectId, dayOfWeek: day, timeSlotId: slot.id, onOccupied });
      await refresh();
      const cells = [`${day}|${slot.id}`];
      if (saved.swapped) cells.push(`${saved.swapped.day_of_week}|${saved.swapped.time_slot_id}`);
      markSaved(cells);
      if (saved.replaced) toast.success('Clase reemplazada', `${item.name} ocupa ahora la hora de ${saved.replaced.subject_name}.`);
      if (saved.swapped) toast.success('Clases intercambiadas', `${item.name} ⇄ ${saved.swapped.subject_name}.`);
    } catch (err) {
      setSaveStatus('error');
      toast.error('No se guardó el cambio', getErrorMessage(err));
    } finally {
      setSaving(false);
      setSelected(null);
    }
  };

  const remove = async (entry) => {
    setSaveStatus('saving');
    try {
      await schedulesApi.remove(entry.id);
      await refresh();
      markSaved([]);
      toast.success('Clase quitada', `${entry.subject_name}`);
    } catch (err) {
      setSaveStatus('error');
      toast.error('No se pudo quitar', getErrorMessage(err));
    }
  };

  /** Año sin bloques: copia los de otro año (sin clases), para no cargarlos a mano. */
  const [copyingSlots, setCopyingSlots] = useState(false);
  const copySlotsFrom = async (source) => {
    setCopyingSlots(true);
    try {
      const slots = await schedulesApi.getSlots(source.id);
      await schedulesApi.saveSlots(periodId, slots.map((s) => ({ name: s.name, startTime: s.start_time, endTime: s.end_time, isBreak: s.is_break })));
      toast.success('Bloques copiados', `Se copiaron ${slots.length} bloques de ${source.name}.`);
      refetchPeriodSlots();
      await load();
    } catch (err) {
      toast.error('No se pudieron copiar los bloques', getErrorMessage(err));
    } finally {
      setCopyingSlots(false);
    }
  };

  const itemOfEntry = (e) => ({
    entryId: e.id,
    day: e.day_of_week,
    slotId: e.time_slot_id,
    subjectId: e.subject_id,
    teacher: { id: e.staff_id, name: e.teacher_name },
    name: e.subject_name,
  });
  const itemOfSubject = (b) => ({ subjectId: b.subject_id, teacher: b.teacher, name: b.subject_name });

  const totalPlaced = data?.entries?.length || 0;
  const freeCells = data ? data.slots.filter((s) => !s.is_break).length * data.days.length : 0;

  // PDF del horario que se está viendo: la sección elegida o el docente elegido.
  const pdfFilters =
    view === 'section'
      ? sectionId && { section_id: sectionId }
      : teacherId && periodId && { teacher_id: teacherId, school_period_id: periodId };
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { blob, fileName } = await schedulesApi.downloadPdf(pdfFilters);
      saveBlob(blob, fileName);
    } catch (err) {
      toast.error('No se pudo generar el PDF', await blobErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Horarios"
        subtitle="Arma el horario semanal de cada sección. El sistema impide que un profesor tenga dos clases a la misma hora."
        actions={
          <>
            {can('schedules', 'update') && period && !period.closed_at && (
              <Button variant="secondary" icon="clock" onClick={() => setEditingSlots(true)}>
                Bloques horarios
              </Button>
            )}
            <Button
              icon="download"
              onClick={downloadPdf}
              loading={downloading}
              loadingText="Generando PDF…"
              disabled={!pdfFilters || downloading}
              title={pdfFilters ? 'Descargar el horario que estás viendo' : view === 'teacher' ? 'Elige un docente' : 'Elige un grado y su sección'}
            >
              Descargar PDF
            </Button>
          </>
        }
      />

      <Card>
        <div className="schedule-filters">
          <div className="segmented schedule-filters__views" role="tablist" aria-label="Ver horario">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                className={`segmented__item ${view === v.key ? 'segmented__item--active' : ''}`}
                onClick={() => setView(v.key)}
              >
                <Icon name={v.icon} size={15} /> {v.label}
              </button>
            ))}
          </div>

          <div className="schedule-filters__fields">
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

            {view === 'section' ? (
              <>
                <label>
                  <span className="student-card__label">Grado</span>
                  {/* Sin `sorted`: orden de la jerarquía escolar (1er Grado, 2do Grado…), no alfabético. */}
                  <Select value={gradeId} onChange={(e) => chooseGrade(e.target.value)} disabled={loadingGrades}>
                    <option value="">{loadingGrades ? 'Cargando grados…' : 'Selecciona…'}</option>
                    {byLevel.map((level) => (
                      <optgroup key={level.name} label={level.name}>
                        {level.grades.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                            {g.list.length ? '' : ' · sin secciones'}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
                <label>
                  <span className="student-card__label">Sección</span>
                  <Select sorted value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!gradeId || !gradeSections.length}>
                    <option value="">{!gradeId ? 'Primero elige el grado' : gradeSections.length ? 'Selecciona…' : 'Sin secciones'}</option>
                    {gradeSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        Sección {s.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </>
            ) : (
              <label className="schedule-filters__teacher">
                <span className="student-card__label">Docente</span>
                <Select sorted value={teacherId} onChange={(e) => setTeacherId(e.target.value)} disabled={loadingTeachers}>
                  <option value="">{loadingTeachers ? 'Cargando docentes…' : 'Selecciona…'}</option>
                  {(teachers || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.classes ? ` · ${t.classes} h/sem` : ' · sin clases'}
                      {t.active ? '' : ' (inactivo)'}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
      </Card>

      {view === 'teacher' &&
        (teacherId && periodId ? (
          <TeacherScheduleView periodId={periodId} teacherId={teacherId} onOpenSection={openSection} />
        ) : (
          <p className="text-muted">Elige un docente para ver su semana completa en todas sus secciones, con sus huecos y su carga por día.</p>
        ))}

      {view === 'section' && (
        <>
          <Alert>{error}</Alert>

          {/* Sin bloques horarios no hay grilla: se avisa de entrada y se ofrece copiarlos de otro año. */}
          {noSlots && period && (
            <Card>
              <div className="empty-state">
                <div className="empty-state__icon">
                  <Icon name="clock" size={24} />
                </div>
                <div className="empty-state__title">El año {period.name} aún no tiene bloques horarios</div>
                <div className="text-sm">
                  Define las horas de clase (por ejemplo 07:00–07:45) para todas las secciones del año; luego podrás arrastrar las materias
                  a la grilla.
                </div>
                {can('schedules', 'update') && !period.closed_at && (
                  <div className="empty-state__actions">
                    {slotSource && (
                      <Button icon="layers" onClick={() => copySlotsFrom(slotSource)} loading={copyingSlots} loadingText="Copiando…">
                        Copiar los bloques de {slotSource.name}
                      </Button>
                    )}
                    <Button variant={slotSource ? 'secondary' : 'primary'} icon="clock" onClick={() => setEditingSlots(true)}>
                      Configurar bloques horarios
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Grado elegido que aún no tiene secciones en el año: el horario es por sección. */}
          {grade && !gradeSections.length && (
            <Card>
              <div className="empty-state">
                <div className="empty-state__icon">
                  <Icon name="layers" size={24} />
                </div>
                <div className="empty-state__title">
                  {grade.name} no tiene secciones en {period?.name}
                </div>
                <div className="text-sm">El horario se arma por sección. Crea la primera para poder asignarle sus clases.</div>
                {can('academics', 'create') && period && !period.closed_at && (
                  <div className="empty-state__actions">
                    <Button icon="plus" onClick={createFirstSection} loading={creatingSection} loadingText="Creando…">
                      Crear la Sección A
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {!noSlots && !gradeId && !loading && (
            <p className="text-muted">
              {byGrade.length
                ? 'Elige un grado para abrir su horario: arrastra las materias del panel a la grilla y cada cambio se guarda al instante.'
                : 'Aún no hay grados configurados: créalos en Estructura académica.'}
            </p>
          )}
          {loading && <Spinner label="Cargando horario…" />}

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
                            e.dataTransfer.effectAllowed = 'copyMove'; // compatible con el dropEffect 'move' de las celdas
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
                {editable && (
                  <div className="schedule-toolbar">
                    <span className="text-sm text-muted">
                      Suelta sobre una clase para <strong>reemplazarla</strong> (desde el panel) o <strong>intercambiarlas</strong> (moviendo una
                      clase). Para quitar una, usa la × o arrástrala al panel.
                    </span>
                    <SaveIndicator status={saveStatus} />
                  </div>
                )}
                {selected && (
                  <Alert variant="info">
                    Toca la celda donde va <strong>{selected.name}</strong> ({selected.teacher?.name}). Si la celda tiene otra clase, se{' '}
                    {selected.entryId ? 'intercambian' : 'reemplaza'}. Las celdas en rojo son horas en que el profesor ya tiene clase.{' '}
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
                  // Tocar una clase: con algo elegido, se coloca ahí (reemplaza/intercambia);
                  // si no, se elige esa clase para moverla (pantallas táctiles, teclado).
                  onEntrySelect={(e) => {
                    if (selected && selected.entryId !== e.id) placeAt(selected, e.day_of_week, { id: e.time_slot_id });
                    else setSelected(selected?.entryId === e.id ? null : itemOfEntry(e));
                  }}
                  selectedEntryId={selected?.entryId}
                  cellHint={(day, slot) => (flash.has(`${day}|${slot.id}`) ? { className: 'is-saved' } : null)}
                />
              </div>
            </div>
          )}
        </>
      )}

      {editingSlots && period && (
        <SlotsEditorModal
          period={period}
          onClose={() => setEditingSlots(false)}
          onSaved={() => {
            refetchPeriodSlots();
            load();
          }}
        />
      )}
    </div>
  );
}

/** Estado del último cambio de la grilla: guardando… / guardado ✓ / error. */
function SaveIndicator({ status }) {
  if (!status) return null;
  const view = {
    saving: { icon: null, text: 'Guardando…' },
    saved: { icon: 'checkCircle', text: 'Cambios guardados' },
    error: { icon: 'alertCircle', text: 'No se guardó' },
  }[status];
  return (
    <span className={`save-indicator save-indicator--${status}`} role="status" aria-live="polite">
      {view.icon ? <Icon name={view.icon} size={14} /> : <span className="save-indicator__spinner" aria-hidden="true" />}
      {view.text}
    </span>
  );
}

export default SchedulesPage;
