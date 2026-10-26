import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import programmaticContentApi from '../../../api/endpoints/programmaticContent.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import { ReviewButton, ReviewInbox } from '../../reviews/components/ReviewWidgets';
import Button from '../../../components/ui/Button';
import Select from '../../../components/ui/Select';
import Field from '../../../components/ui/Field';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { useToast } from '../../../components/ui/Toast';
import { termLabel } from '../../evaluation-plans/terms';
import { CATEGORY_LABELS } from '../categories';
import ContentItemModal from '../components/ContentItemModal';
import IncludeEvaluationModal from '../components/IncludeEvaluationModal';
import BulkImportActions from '../../../components/import/BulkImportActions';
import { currentPeriod } from '../../../lib/schoolPeriods';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** '2026-10-20' → "20 oct" (fecha de calendario, sin corrimiento de zona horaria). */
function shortDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

const UNIT_DROP = 'unit:';

/** Textos en español para el lector de pantalla durante el arrastre (teclado: espacio para tomar y soltar). */
const DND_A11Y = {
  screenReaderInstructions: {
    draggable: 'Para mover la evaluación a otro tema, pulsa espacio, usa las flechas para elegir el tema y vuelve a pulsar espacio. Escape cancela.',
  },
  announcements: {
    onDragStart: ({ active }) => `Moviendo ${active.data.current?.activity?.title || 'la evaluación'}.`,
    onDragOver: ({ over }) => (over ? `Sobre ${over.data.current?.label || 'un destino'}.` : 'Fuera de los temas.'),
    onDragEnd: ({ over }) => (over ? `Soltada en ${over.data.current?.label || 'el destino'}.` : 'Movimiento cancelado.'),
    onDragCancel: () => 'Movimiento cancelado.',
  },
};

/**
 * Una evaluación de un tema: actividad, tipo, peso, plan (lapso y secciones) y
 * fecha. Con `draggable`, el asa permite moverla a otro tema (de cualquier unidad).
 */
function ActivityRow({ activity: a, topicId, draggable }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: a.id, data: { activity: a, topicId }, disabled: !draggable });
  return (
    <li ref={setNodeRef} className={`pc-activity ${draggable ? 'pc-activity--draggable' : ''} ${isDragging ? 'is-dragging' : ''}`}>
      {draggable && (
        <button type="button" className="pc-drag-handle" aria-label={`Mover ${a.title} a otro tema`} title="Arrastra para moverla a otro tema" {...attributes} {...listeners}>
          <Icon name="grip" size={16} />
        </button>
      )}
      <div className="pc-activity__main">
        <span className="pc-activity__title">{a.title}</span>
        <span className="pc-activity__meta">
          {termLabel(a.plan.term_number, a.plan.term_name)} · Secc. {a.plan.section_names}
          {a.planned_date && ` · ${shortDate(a.planned_date)}`}
        </span>
      </div>
      <Badge variant="primary">{CATEGORY_LABELS[a.category] || a.category}</Badge>
      <strong className="pc-activity__weight">{a.weight_percent}%</strong>
      <Link to={`/evaluation-plans/${a.plan.id}`} className="pc-activity__link" title="Abrir el plan de evaluación">
        Ver plan <Icon name="arrowRight" size={13} />
      </Link>
    </li>
  );
}

/** Tema como destino del arrastre: se resalta cuando la evaluación viene de otro tema. */
function DroppableTopic({ item, unit, className, children }) {
  const { setNodeRef, isOver, active } = useDroppable({ id: item.id, data: { label: `${unit} · ${item.topic}` } });
  const target = isOver && active?.data.current?.topicId !== item.id;
  return (
    <article ref={setNodeRef} className={`${className} ${target ? 'is-drop-target' : ''}`}>
      {children}
    </article>
  );
}

/** Cabecera de unidad como destino: al pasar por encima de una unidad cerrada, se abre para elegir el tema. */
function DroppableUnitHead({ unit, children, ...props }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${UNIT_DROP}${unit}`, data: { label: unit } });
  return (
    <button ref={setNodeRef} type="button" className={`pc-unit__head ${isOver ? 'is-drop-hover' : ''}`} {...props}>
      {children}
    </button>
  );
}

/**
 * Contenido programático de una materia en un grado, en forma de acordeón:
 * Unidad → Temas → evaluaciones de cada tema. Desde cada tema se incluye una
 * evaluación (actividad de un plan de evaluación vinculada al tema); un tema
 * puede tener varias. El docente ve solo sus materias y grados, y solo sus
 * planes y evaluaciones.
 * URL: ?materia=<subjectId>&grado=<gradeId>&ano=<schoolPeriodId>
 */
function ProgrammaticContentPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const subjectId = params.get('materia') || '';
  const gradeId = params.get('grado') || '';
  const { data: options, loading: loadingOptions, error: optionsError } = useFetch(() => programmaticContentApi.listOptions(), []);
  const { data: periods } = useFetch(() => evaluationPlansApi.listPeriodOptions(), []);
  const periodId = params.get('ano') || '';
  const [version, setVersion] = useState(0);
  const [closedUnits, setClosedUnits] = useState(() => new Set());
  const [openTopics, setOpenTopics] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // null | { unit? } nuevo | ítem
  const [including, setIncluding] = useState(null);

  const setParam = (patch) => setParams((p) => ({ ...Object.fromEntries(p), ...patch }), { replace: true });

  // Enlace de una notificación (?revision=1): abre el panel de revisión una vez y limpia la URL.
  const [openReview, setOpenReview] = useState(() => params.get('revision') === '1');
  useEffect(() => {
    if (!params.has('revision')) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('revision');
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Por defecto: la primera materia/grado disponible y el año activo más reciente.
  useEffect(() => {
    if (!options?.length) return;
    const valid = options.some((o) => o.subject_id === subjectId && o.grade_id === gradeId);
    if (valid) return;
    const sameSubject = options.find((o) => o.subject_id === subjectId);
    const pick = sameSubject || options[0];
    setParam({ materia: pick.subject_id, grado: pick.grade_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, subjectId, gradeId]);
  useEffect(() => {
    if (periodId || !periods?.length) return;
    const sorted = [...periods].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    setParam({ ano: (currentPeriod(sorted) || sorted[0]).id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, periodId]);

  const selected = options?.find((o) => o.subject_id === subjectId && o.grade_id === gradeId);
  const { data: content, setData: setContent, loading, error } = useFetch(
    () => (selected ? programmaticContentApi.get({ gradeId, subjectId, schoolPeriodId: periodId || undefined }) : Promise.resolve(null)),
    [selected?.subject_id, selected?.grade_id, periodId, version]
  );
  const reload = () => setVersion((v) => v + 1);
  // El panel ya se abrió con el contenido cargado: las recargas siguientes no lo vuelven a abrir.
  useEffect(() => {
    if (!content || !openReview) return undefined;
    const id = setTimeout(() => setOpenReview(false), 0);
    return () => clearTimeout(id);
  }, [content, openReview]);
  const handleImported = (report) => {
    if (report.summary.invalid > 0) toast.warning('Importación con observaciones', report.message);
    else toast.success(plural(report.summary.imported, 'tema importado', 'temas importados'), report.message);
    reload();
  };

  // Materias agrupadas con sus grados para el selector.
  const subjects = useMemo(() => {
    const map = new Map();
    (options || []).forEach((o) => {
      if (!map.has(o.subject_id)) map.set(o.subject_id, { id: o.subject_id, name: o.subject_name, grades: [] });
      map.get(o.subject_id).grades.push(o);
    });
    return [...map.values()];
  }, [options]);

  const items = content ? content.units.flatMap((u) => u.items) : [];
  const evaluationCount = items.reduce((n, i) => n + i.activities.length, 0);
  const units = content ? content.units.map((u) => u.unit) : [];
  const periodClosed = Boolean(content?.school_period?.closed);
  const pair = content && { gradeId, subjectId, gradeName: content.grade_name, subjectName: content.subject_name };
  // Revisión académica (059): con la revisión activa, el docente no edita lo que está en revisión o aprobado.
  const review = content?.review || null;
  const locked = Boolean(review?.locked);
  const canEditContent = (action) => can('evaluation_plans', action) && !locked;
  const canCreate = canEditContent('create') && Boolean(content);
  // Carga masiva del temario: plantilla base (unidades actuales como guía) y subida.
  const bulkProps = content && {
    type: 'programmatic_content',
    params: { gradeId, subjectId },
    downloadTitle: `Excel para cargar unidades y temas de ${content.subject_name} (${content.grade_name})`,
    title: 'Carga masiva de contenido programático',
    description: `Los temas del archivo se agregan a ${content.subject_name} de ${content.grade_name}, después de los que ya tiene.`,
    onImported: handleImported,
  };
  const reviewLabel =
    review?.my_role === 'author'
      ? { borrador: 'Enviar a revisión', observado: 'Ver ajustes y reenviar' }[review.status]
      : review?.my_role === 'reviewer' && review.status === 'en_revision'
        ? 'Revisar contenido'
        : null;

  const toggle = (setter, key) =>
    setter((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const removeItem = async (item) => {
    const ok = await confirm({
      title: `¿Eliminar el tema "${item.topic}"?`,
      message: item.activities.length
        ? `Tiene ${plural(item.activities.length, 'evaluación', 'evaluaciones')}: no se borran (pueden tener notas); quedan en su plan de evaluación, sin tema.`
        : 'Se quitará del contenido programático.',
      danger: true,
      confirmLabel: 'Eliminar tema',
    });
    if (!ok) return;
    try {
      const res = await programmaticContentApi.remove(item.id);
      toast.success('Tema eliminado', res.unlinkedActivities ? `${plural(res.unlinkedActivities, 'evaluación quedó', 'evaluaciones quedaron')} sin tema` : item.topic);
      reload();
    } catch (err) {
      toast.error('No se pudo eliminar', getErrorMessage(err));
    }
  };

  // ---- Mover una evaluación a otro tema (arrastrar y soltar) ----
  const [dragging, setDragging] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const canMove = (a) => can('evaluation_plans', 'update') && !periodClosed && a.plan.status !== 'closed';

  /** Copia del contenido con la evaluación movida de un tema a otro (para mostrarlo al instante). */
  const withActivityMoved = (data, activityId, toTopicId) => {
    let moved = null;
    const stripped = data.units.map((u) => ({
      ...u,
      items: u.items.map((i) => {
        const found = i.activities.find((x) => x.id === activityId);
        if (found) moved = found;
        return found ? { ...i, activities: i.activities.filter((x) => x.id !== activityId) } : i;
      }),
    }));
    if (!moved) return data;
    return {
      ...data,
      units: stripped.map((u) => ({ ...u, items: u.items.map((i) => (i.id === toTopicId ? { ...i, activities: [...i.activities, moved] } : i)) })),
    };
  };

  const handleDragOver = ({ over }) => {
    const id = over?.id ? String(over.id) : '';
    if (id.startsWith(UNIT_DROP)) {
      const unit = id.slice(UNIT_DROP.length);
      setClosedUnits((s) => (s.has(unit) ? new Set([...s].filter((x) => x !== unit)) : s));
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    setDragging(null);
    if (!over || !content) return;
    const fromTopicId = active.data.current.topicId;
    const activity = active.data.current.activity;
    let toTopicId = String(over.id);
    // Soltada sobre la cabecera de una unidad: vale si la unidad tiene un solo tema.
    if (toTopicId.startsWith(UNIT_DROP)) {
      const unit = content.units.find((u) => u.unit === toTopicId.slice(UNIT_DROP.length));
      if (!unit || unit.items.length !== 1) return;
      toTopicId = unit.items[0].id;
    }
    if (toTopicId === fromTopicId) return;

    const target = items.find((i) => i.id === toTopicId);
    const previous = content;
    setContent(withActivityMoved(content, activity.id, toTopicId));
    setOpenTopics((s) => new Set(s).add(toTopicId));
    try {
      await evaluationPlansApi.setActivityContent(activity.plan.id, activity.id, toTopicId);
      toast.success('Evaluación movida', `${activity.title} → ${target.unit} · ${target.topic}`);
    } catch (err) {
      setContent(previous);
      toast.error('No se pudo mover la evaluación', getErrorMessage(err));
    }
  };

  if (loadingOptions) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Contenido programático"
        subtitle="Unidades y temas de cada materia, con las evaluaciones de cada tema. Despliega un tema para ver sus evaluaciones o incluir una nueva."
      />
      <Alert>{optionsError}</Alert>
      {/* Coordinador / Director: programas que esperan su revisión. */}
      <ReviewInbox type="content" onChanged={reload} />

      {options?.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-state__icon">
            <Icon name="layers" size={24} />
          </div>
          <div className="empty-state__title">No hay materias disponibles</div>
          <div className="text-sm">Las materias de cada grado se configuran en Materias; los docentes ven aquí las que dictan.</div>
        </div>
      ) : (
        <>
          <div className="card data-table pc-header">
            <div className="data-table__header">
              <div>
                <h3 className="card__title">
                  {content ? `${content.subject_name} · ${content.grade_name}` : 'Temario'}
                  {content && <span className="data-table__count">{items.length}</span>}
                </h3>
                <p className="card__subtitle">
                  {content
                    ? `${plural(units.length, 'unidad', 'unidades')} · ${plural(items.length, 'tema', 'temas')} · ${plural(evaluationCount, 'evaluación', 'evaluaciones')}${
                        content.school_period ? ` en ${content.school_period.name}` : ''
                      }`
                    : 'Elige la materia y el grado para ver su temario.'}
                </p>
              </div>
              {content && (review?.enabled || canCreate) && (
                <div className="data-table__header-actions">
                  {/* Revisión del programa completo de esta materia en este grado (solo si el colegio la exige). */}
                  {review?.enabled && (
                    <ReviewButton
                      target={{ gradeId, subjectId }}
                      title={`${content.subject_name} · ${content.grade_name}`}
                      key={`${gradeId}|${subjectId}|${version}`}
                      status={review.status}
                      label={reviewLabel || 'Revisión'}
                      primary={Boolean(reviewLabel)}
                      defaultOpen={openReview}
                      onChanged={reload}
                    />
                  )}
                  {canCreate && (
                    <>
                      {/* Misma botonera que en Planes de evaluación (allí la plantilla viene con los temas). */}
                      <BulkImportActions {...bulkProps} />
                      <Button icon="plus" onClick={() => setEditing({})}>
                        Nuevo tema
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            {locked && (
              <div className={`pc-review-lock is-${review.status}`} role="status">
                <Icon name={review.status === 'aprobado' ? 'checkCircle' : 'lock'} size={18} />
                <div>
                  <strong>{review.status === 'aprobado' ? 'Contenido aprobado' : 'En revisión de coordinación'}</strong>
                  <span>
                    {review.status === 'aprobado'
                      ? 'Quedó fijo de forma definitiva. Si necesitas cambiar algo, pide a coordinación que lo reabra desde «Revisión».'
                      : 'No se puede editar hasta que coordinación lo apruebe o te solicite ajustes. Te avisaremos por la campana.'}
                  </span>
                </div>
              </div>
            )}

            <div className="pc-toolbar">
              <Field label="Materia">
                <Select
                  value={subjectId}
                  onChange={(e) => {
                    const s = subjects.find((x) => x.id === e.target.value);
                    setParam({ materia: s.id, grado: s.grades[0].grade_id });
                  }}
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Grado">
                <Select value={gradeId} onChange={(e) => setParam({ grado: e.target.value })}>
                  {(subjects.find((s) => s.id === subjectId)?.grades || []).map((g) => (
                    <option key={g.grade_id} value={g.grade_id}>
                      {g.grade_name} ({plural(g.content_count, 'tema', 'temas')})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Evaluaciones del año">
                <Select value={periodId} onChange={(e) => setParam({ ano: e.target.value })}>
                  {(periods || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.closed_at ? ' (finalizado)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Alert>{error}</Alert>
          </div>

          {loading && !content ? (
            <Spinner />
          ) : (
            content && (
              <>
                {items.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state__icon">
                      <Icon name="layers" size={24} />
                    </div>
                    <div className="empty-state__title">
                      {content.subject_name} de {content.grade_name} aún no tiene contenido programático
                    </div>
                    <div className="text-sm">
                      Agrega sus temas por unidad (ej. Unidad I · Estructura celular) o cárgalos todos desde la plantilla de Excel.
                    </div>
                    {canCreate && (
                      <div className="empty-state__actions">
                        <BulkImportActions {...bulkProps} />
                        <Button icon="plus" onClick={() => setEditing({})}>
                          Nuevo tema
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    accessibility={DND_A11Y}
                    onDragStart={({ active }) => setDragging(active.data.current.activity)}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setDragging(null)}
                  >
                  <div className={`pc-units ${dragging ? 'is-dragging' : ''}`}>
                    {content.units.map((u) => {
                      const open = !closedUnits.has(u.unit);
                      const unitEvaluations = u.items.reduce((n, i) => n + i.activities.length, 0);
                      return (
                        <section key={u.unit} className={`pc-unit ${open ? 'is-open' : ''}`}>
                          <DroppableUnitHead unit={u.unit} onClick={() => toggle(setClosedUnits, u.unit)} aria-expanded={open}>
                            <Icon name="chevronDown" size={16} className="pc-unit__chevron" />
                            <span className="pc-unit__name">{u.unit}</span>
                            <span className="pc-unit__meta">
                              {plural(u.items.length, 'tema', 'temas')} · {plural(unitEvaluations, 'evaluación', 'evaluaciones')}
                            </span>
                          </DroppableUnitHead>
                          {open && (
                            <div className="pc-unit__body">
                              {u.items.map((item) => {
                                const expanded = openTopics.has(item.id);
                                return (
                                  <DroppableTopic key={item.id} item={item} unit={u.unit} className={`pc-topic ${expanded ? 'is-open' : ''}`}>
                                    <div className="pc-topic__head">
                                      <button type="button" className="pc-topic__toggle" onClick={() => toggle(setOpenTopics, item.id)} aria-expanded={expanded}>
                                        <span className="pc-topic__title">{item.topic}</span>
                                        <span className="pc-topic__desc">{item.description}</span>
                                      </button>
                                      <button
                                        type="button"
                                        className={`pc-topic__count ${item.activities.length ? 'has-items' : ''}`}
                                        onClick={() => toggle(setOpenTopics, item.id)}
                                        aria-expanded={expanded}
                                      >
                                        {plural(item.activities.length, 'evaluación', 'evaluaciones')}
                                        <Icon name="chevronDown" size={14} />
                                      </button>
                                      <div className="pc-topic__actions">
                                        {can('evaluation_plans', 'create') && (
                                          <Button
                                            size="sm"
                                            icon="plus"
                                            onClick={() => setIncluding(item)}
                                            disabled={!content.school_period || periodClosed || (content.plans.length === 0 && content.sections.length === 0)}
                                            title={
                                              !content.school_period
                                                ? 'Elige un año escolar'
                                                : periodClosed
                                                  ? 'El año escolar está finalizado'
                                                  : content.plans.length === 0 && content.sections.length === 0
                                                    ? 'No hay secciones de este grado con la materia en el año'
                                                    : undefined
                                            }
                                          >
                                            Incluir evaluación
                                          </Button>
                                        )}
                                        {canEditContent('update') && (
                                          <button type="button" className="pc-icon-btn" onClick={() => setEditing(item)} aria-label={`Editar ${item.topic}`} title="Editar tema">
                                            <Icon name="pencil" size={15} />
                                          </button>
                                        )}
                                        {canEditContent('delete') && (
                                          <button type="button" className="pc-icon-btn pc-icon-btn--danger" onClick={() => removeItem(item)} aria-label={`Eliminar ${item.topic}`} title="Eliminar tema">
                                            <Icon name="trash" size={15} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {expanded && (
                                      <div className="pc-topic__body">
                                        <p className="pc-topic__full">{item.description}</p>
                                        {item.activities.length === 0 ? (
                                          <p className="text-sm text-muted">Este tema aún no tiene evaluaciones en {content.school_period?.name || 'el año elegido'}.</p>
                                        ) : (
                                          <ul className="pc-activities">
                                            {item.activities.map((a) => (
                                              <ActivityRow key={a.id} activity={a} topicId={item.id} draggable={canMove(a)} />
                                            ))}
                                          </ul>
                                        )}
                                        {item.activities.some(canMove) && (
                                          <p className="pc-drag-hint">
                                            <Icon name="grip" size={13} /> Arrastra una evaluación desde su asa hasta otro tema (o a otra unidad) para moverla.
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </DroppableTopic>
                                );
                              })}
                              {canEditContent('create') && (
                                <button type="button" className="pc-add-topic" onClick={() => setEditing({ unit: u.unit })}>
                                  <Icon name="plus" size={14} /> Agregar tema a {u.unit}
                                </button>
                              )}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <DragOverlay dropAnimation={null}>
                    {dragging && (
                      <div className="pc-drag-preview">
                        <Icon name="grip" size={15} />
                        <strong>{dragging.title}</strong>
                        <span>{dragging.weight_percent}%</span>
                      </div>
                    )}
                  </DragOverlay>
                  </DndContext>
                )}
              </>
            )
          )}
        </>
      )}

      {editing !== null && pair && (
        <ContentItemModal
          initial={editing.id ? editing : null}
          defaultUnit={editing.id ? undefined : editing.unit}
          pair={pair}
          units={units}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {including && content && (
        <IncludeEvaluationModal
          item={including}
          content={content}
          onClose={() => setIncluding(null)}
          onSaved={() => {
            setOpenTopics((s) => new Set(s).add(including.id));
            reload();
          }}
        />
      )}
    </div>
  );
}

export default ProgrammaticContentPage;
