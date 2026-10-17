import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import programmaticContentApi from '../../../api/endpoints/programmaticContent.api';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
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
import ImportButton from '../../../components/import/ImportButton';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** '2026-10-20' → "20 oct" (fecha de calendario, sin corrimiento de zona horaria). */
function shortDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/** Una evaluación de un tema: actividad, tipo, peso, plan (lapso y secciones) y fecha. */
function ActivityRow({ activity: a }) {
  return (
    <li className="pc-activity">
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
    setParam({ ano: (sorted.find((p) => p.is_active && !p.closed_at) || sorted[0]).id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods, periodId]);

  const selected = options?.find((o) => o.subject_id === subjectId && o.grade_id === gradeId);
  const { data: content, loading, error } = useFetch(
    () => (selected ? programmaticContentApi.get({ gradeId, subjectId, schoolPeriodId: periodId || undefined }) : Promise.resolve(null)),
    [selected?.subject_id, selected?.grade_id, periodId, version]
  );
  const reload = () => setVersion((v) => v + 1);
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
  const canCreate = can('evaluation_plans', 'create') && Boolean(content);

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

  if (loadingOptions) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Contenido programático"
        subtitle="Unidades y temas de cada materia, con las evaluaciones de cada tema. Despliega un tema para ver sus evaluaciones o incluir una nueva."
      />
      <Alert>{optionsError}</Alert>

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
              {canCreate && (
                <div className="data-table__header-actions">
                  <ImportButton
                    type="programmatic_content"
                    label="Importar masivo"
                    title="Importar contenido programático"
                    description={`Los temas se agregan a ${content.subject_name} de ${content.grade_name}.`}
                    params={{ gradeId, subjectId }}
                    onImported={handleImported}
                  />
                  <Button icon="plus" onClick={() => setEditing({})}>
                    Nuevo tema
                  </Button>
                </div>
              )}
            </div>

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
                        <Button icon="plus" onClick={() => setEditing({})}>
                          Nuevo tema
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="pc-units">
                    {content.units.map((u) => {
                      const open = !closedUnits.has(u.unit);
                      const unitEvaluations = u.items.reduce((n, i) => n + i.activities.length, 0);
                      return (
                        <section key={u.unit} className={`pc-unit ${open ? 'is-open' : ''}`}>
                          <button type="button" className="pc-unit__head" onClick={() => toggle(setClosedUnits, u.unit)} aria-expanded={open}>
                            <Icon name="chevronDown" size={16} className="pc-unit__chevron" />
                            <span className="pc-unit__name">{u.unit}</span>
                            <span className="pc-unit__meta">
                              {plural(u.items.length, 'tema', 'temas')} · {plural(unitEvaluations, 'evaluación', 'evaluaciones')}
                            </span>
                          </button>
                          {open && (
                            <div className="pc-unit__body">
                              {u.items.map((item) => {
                                const expanded = openTopics.has(item.id);
                                return (
                                  <article key={item.id} className={`pc-topic ${expanded ? 'is-open' : ''}`}>
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
                                        {can('evaluation_plans', 'update') && (
                                          <button type="button" className="pc-icon-btn" onClick={() => setEditing(item)} aria-label={`Editar ${item.topic}`} title="Editar tema">
                                            <Icon name="pencil" size={15} />
                                          </button>
                                        )}
                                        {can('evaluation_plans', 'delete') && (
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
                                              <ActivityRow key={a.id} activity={a} />
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                              {can('evaluation_plans', 'create') && (
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
