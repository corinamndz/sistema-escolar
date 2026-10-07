import { useState } from 'react';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Modal from '../../../components/ui/Modal';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { TermSelect, termLabel } from '../terms';

export const FORMATS = {
  simple: {
    label: 'Formato simple',
    detail: 'Actividad, descripción y porcentaje.',
    icon: 'clipboard',
  },
  detailed: {
    label: 'Formato detallado',
    detail: 'Planificador institucional: referencias, estrategia, criterios e indicadores con puntaje y fechas por sección.',
    icon: 'layers',
  },
};

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(String(v).replace(',', '.')));

/** '2026-10-15' → "15 oct" (fecha de calendario). */
export function shortDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Selector de formato (tarjetas)
// ---------------------------------------------------------------------------

export function FormatPicker({ value, onChange, disabled }) {
  return (
    <div className="format-picker" role="radiogroup" aria-label="Tipo de formato del plan">
      {Object.entries(FORMATS).map(([key, f]) => (
        <label key={key} className={`format-picker__option ${value === key ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}>
          <input type="radio" name="plan-format" value={key} checked={value === key} disabled={disabled} onChange={() => onChange(key)} />
          <span className="format-picker__icon">
            <Icon name={f.icon} size={18} />
          </span>
          <span>
            <strong>{f.label}</strong>
            <span className="format-picker__detail">{f.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista del planificador (formato detallado)
// ---------------------------------------------------------------------------

/**
 * Tabla estilo planificador institucional: una fila por actividad con sus
 * referencias, estrategia, criterios e indicadores (con puntaje), ponderación
 * y fecha de aplicación en cada sección del plan.
 */
export function PlannerTable({ activities, sections, categoryLabels, renderActions }) {
  if (!activities.length) return <p className="text-muted">Aún no hay actividades en este plan.</p>;
  return (
    <div className="table-wrap">
      <table className="table planner-table">
        <thead>
          <tr>
            <th>Referencias teórico-prácticas</th>
            <th>Estrategia evaluativa</th>
            <th>Criterios e indicadores</th>
            <th className="planner-table__num">Puntaje</th>
            <th className="planner-table__num">Ponderación</th>
            <th>Fechas de aplicación</th>
            {renderActions && <th aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => {
            const indicators = a.criteria.flatMap((c, ci) => c.indicators.map((i, ii) => ({ ...i, code: `${ci + 1}.${ii + 1}` })));
            return (
              <tr key={a.id}>
                <td>
                  {a.content_refs?.length ? (
                    <ul className="planner-refs">
                      {a.content_refs.map((t, i) => (
                        <li key={i}>
                          <strong>{t.topic}</strong>
                          {t.subtopics?.length > 0 && (
                            <ul>
                              {t.subtopics.map((s, j) => (
                                <li key={j}>{s}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <div className="cell-person__name">{a.title}</div>
                  {a.strategy && <div>{a.strategy}</div>}
                  <Badge variant="primary">{categoryLabels[a.category] || a.category}</Badge>
                </td>
                <td>
                  {a.criteria.length ? (
                    <ol className="planner-criteria">
                      {a.criteria.map((c, ci) => (
                        <li key={c.id}>
                          <strong>
                            {ci + 1}. {c.title}
                          </strong>
                          <ul>
                            {c.indicators.map((i, ii) => (
                              <li key={i.id}>
                                <span className="planner-code">
                                  {ci + 1}.{ii + 1}
                                </span>{' '}
                                {i.description}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <span className="text-muted">Sin criterios</span>
                  )}
                </td>
                <td className="planner-table__num">
                  {indicators.length > 0 && (
                    <ul className="planner-points">
                      {indicators.map((i) => (
                        <li key={i.id}>
                          <span className="planner-code">{i.code}</span> {i.points} pts
                        </li>
                      ))}
                    </ul>
                  )}
                  <strong>{a.max_score} pts</strong>
                </td>
                <td className="planner-table__num">
                  <strong>{Number(a.weight_percent)}%</strong>
                </td>
                <td>
                  <ul className="planner-dates">
                    {sections.map((s) => {
                      const d = a.section_dates?.find((x) => x.section_id === s.id);
                      return (
                        <li key={s.id}>
                          Secc. {s.name}: {d ? <strong>{shortDay(d.applied_on)}</strong> : <span className="text-muted">sin fecha</span>}
                        </li>
                      );
                    })}
                  </ul>
                </td>
                {renderActions && <td className="planner-table__actions">{renderActions(a)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editores de la actividad detallada
// ---------------------------------------------------------------------------

/** Referencias teórico-prácticas: temas con subtemas. */
export function ContentRefsEditor({ value, onChange }) {
  const set = (i, patch) => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="nested-editor">
      {value.map((t, i) => (
        <div key={i} className="nested-editor__group">
          <div className="nested-editor__row">
            <Input value={t.topic} onChange={(e) => set(i, { topic: e.target.value })} placeholder="Tema (ej. Números reales)" aria-label={`Tema ${i + 1}`} />
            <button type="button" className="row-action row-action--delete" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Quitar tema" title="Quitar tema">
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="nested-editor__children">
            {t.subtopics.map((s, k) => (
              <div key={k} className="nested-editor__row">
                <span className="nested-editor__bullet" aria-hidden="true">›</span>
                <Input
                  value={s}
                  onChange={(e) => set(i, { subtopics: t.subtopics.map((x, y) => (y === k ? e.target.value : x)) })}
                  placeholder="Subtema (ej. Definición)"
                  aria-label={`Subtema ${k + 1} de ${t.topic || `tema ${i + 1}`}`}
                />
                <button type="button" className="row-action row-action--delete" onClick={() => set(i, { subtopics: t.subtopics.filter((_, y) => y !== k) })} aria-label="Quitar subtema" title="Quitar subtema">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" icon="plus" onClick={() => set(i, { subtopics: [...t.subtopics, ''] })}>
              Subtema
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" icon="plus" onClick={() => onChange([...value, { topic: '', subtopics: [''] }])}>
        Agregar tema
      </Button>
    </div>
  );
}

/**
 * Criterios con sus indicadores (código 1.1, 1.2…) y puntaje. Muestra en vivo
 * cuánto suman los puntajes contra el puntaje máximo de la actividad.
 * `locked`: la actividad ya tiene notas → solo se editan textos.
 */
export function CriteriaEditor({ value, onChange, maxScore, locked }) {
  const setCriterion = (ci, patch) => onChange(value.map((c, j) => (j === ci ? { ...c, ...patch } : c)));
  const setIndicator = (ci, ii, patch) =>
    setCriterion(ci, { indicators: value[ci].indicators.map((ind, k) => (k === ii ? { ...ind, ...patch } : ind)) });
  const total = round2(value.flatMap((c) => c.indicators).reduce((n, i) => n + (Number.isFinite(num(i.points)) ? num(i.points) : 0), 0));
  const max = num(maxScore);
  const state = !value.length ? 'empty' : total === round2(max) ? 'ok' : total > max ? 'over' : 'under';

  return (
    <div className="nested-editor">
      {locked && (
        <Alert variant="info">Esta actividad ya tiene notas: puedes corregir los textos, pero no agregar o quitar indicadores ni cambiar sus puntajes.</Alert>
      )}
      {value.map((c, ci) => (
        <div key={c.id || `new-${ci}`} className="nested-editor__group">
          <div className="nested-editor__row">
            <span className="planner-code">{ci + 1}.</span>
            <Input value={c.title} onChange={(e) => setCriterion(ci, { title: e.target.value })} placeholder="Criterio (ej. Resolución de ejercicios)" aria-label={`Criterio ${ci + 1}`} />
            {!locked && (
              <button type="button" className="row-action row-action--delete" onClick={() => onChange(value.filter((_, j) => j !== ci))} aria-label="Quitar criterio" title="Quitar criterio">
                <Icon name="trash" size={14} />
              </button>
            )}
          </div>
          <div className="nested-editor__children">
            {c.indicators.map((ind, ii) => (
              <div key={ind.id || `new-${ii}`} className="nested-editor__row">
                <span className="planner-code">
                  {ci + 1}.{ii + 1}
                </span>
                <Input
                  value={ind.description}
                  onChange={(e) => setIndicator(ci, ii, { description: e.target.value })}
                  placeholder="Indicador (ej. Seguimiento de instrucciones)"
                  aria-label={`Indicador ${ci + 1}.${ii + 1}`}
                />
                <Input
                  className="nested-editor__points"
                  inputMode="decimal"
                  value={ind.points}
                  onChange={(e) => setIndicator(ci, ii, { points: e.target.value })}
                  suffix="pts"
                  disabled={locked}
                  aria-label={`Puntaje del indicador ${ci + 1}.${ii + 1}`}
                />
                {!locked && (
                  <button
                    type="button"
                    className="row-action row-action--delete"
                    onClick={() => setCriterion(ci, { indicators: c.indicators.filter((_, k) => k !== ii) })}
                    aria-label="Quitar indicador"
                    title="Quitar indicador"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
            {!locked && (
              <Button type="button" size="sm" variant="ghost" icon="plus" onClick={() => setCriterion(ci, { indicators: [...c.indicators, { description: '', points: '' }] })}>
                Indicador
              </Button>
            )}
          </div>
        </div>
      ))}
      {!locked && (
        <Button type="button" size="sm" variant="secondary" icon="plus" onClick={() => onChange([...value, { title: '', indicators: [{ description: '', points: '' }] }])}>
          Agregar criterio
        </Button>
      )}
      {value.length > 0 && (
        <div className={`points-total points-total--${state}`} role="status">
          <Icon name={state === 'ok' ? 'checkCircle' : 'alertTriangle'} size={15} />
          Los indicadores suman <strong>{total}</strong> de {Number.isFinite(max) ? round2(max) : '—'} pts
          {state === 'under' && ` · faltan ${round2(max - total)}`}
          {state === 'over' && ` · sobran ${round2(total - max)}`}
        </div>
      )}
    </div>
  );
}

/** Estado inicial del formulario detallado a partir de una actividad (o vacío). */
export function detailedFormFrom(activity, sections) {
  return {
    strategy: activity.strategy || '',
    maxScore: activity.max_score ?? 20,
    contentRefs: (activity.content_refs || []).map((t) => ({ topic: t.topic, subtopics: t.subtopics?.length ? t.subtopics : [''] })),
    criteria: activity.criteria?.length
      ? activity.criteria.map((c) => ({ id: c.id, title: c.title, indicators: c.indicators.map((i) => ({ id: i.id, description: i.description, points: String(i.points) })) }))
      : [{ title: '', indicators: [{ description: '', points: '' }] }],
    sectionDates: Object.fromEntries(sections.map((s) => [s.id, activity.section_dates?.find((d) => d.section_id === s.id)?.applied_on || ''])),
  };
}

/**
 * Valida el formulario detallado y arma el cuerpo para la API. Devuelve
 * { error } o { body }. Quita filas vacías (temas, subtemas).
 */
export function detailedBody(form) {
  const maxScore = num(form.maxScore);
  if (!(maxScore > 0)) return { error: 'El puntaje de la actividad debe ser mayor que 0.' };
  const criteria = form.criteria
    .filter((c) => c.title.trim() || c.indicators.some((i) => i.description.trim()))
    .map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      title: c.title.trim(),
      indicators: c.indicators
        .filter((i) => i.description.trim() || String(i.points).trim())
        .map((i) => ({ ...(i.id ? { id: i.id } : {}), description: i.description.trim(), points: num(i.points) })),
    }));
  for (const [ci, c] of criteria.entries()) {
    if (!c.title) return { error: `Escribe el título del criterio ${ci + 1}.` };
    if (!c.indicators.length) return { error: `El criterio ${ci + 1} necesita al menos un indicador.` };
    for (const [ii, i] of c.indicators.entries()) {
      if (!i.description) return { error: `Escribe el indicador ${ci + 1}.${ii + 1}.` };
      if (!(i.points > 0)) return { error: `El indicador ${ci + 1}.${ii + 1} necesita un puntaje mayor que 0.` };
    }
  }
  const total = round2(criteria.flatMap((c) => c.indicators).reduce((n, i) => n + i.points, 0));
  if (criteria.length && total !== round2(maxScore)) {
    return { error: `Los indicadores suman ${total} y deben sumar el puntaje de la actividad (${round2(maxScore)}).` };
  }
  return {
    body: {
      strategy: form.strategy.trim() || null,
      maxScore,
      contentRefs: form.contentRefs
        .filter((t) => t.topic.trim())
        .map((t) => ({ topic: t.topic.trim(), subtopics: t.subtopics.map((s) => s.trim()).filter(Boolean) })),
      criteria,
      sectionDates: Object.entries(form.sectionDates)
        .filter(([, date]) => date)
        .map(([sectionId, date]) => ({ sectionId, date })),
    },
  };
}

// ---------------------------------------------------------------------------
// Formato y secciones del plan
// ---------------------------------------------------------------------------

/** Tarjeta de configuración: formato (simple/detallado) y secciones a las que se aplica el plan. */
export function PlanSettings({ plan, canEdit, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editingSections, setEditingSections] = useState(false);
  const [moving, setMoving] = useState(false);

  const changeFormat = async (format) => {
    if (format === plan.format) return;
    const ok = await confirm({
      title: format === 'detailed' ? '¿Pasar al formato detallado?' : '¿Volver al formato simple?',
      message:
        format === 'detailed'
          ? 'Podrás agregar a cada actividad referencias, estrategia, criterios e indicadores con puntaje y fechas por sección. Lo ya cargado se conserva.'
          : 'Solo es posible si ninguna actividad tiene criterios e indicadores.',
      confirmLabel: 'Cambiar formato',
    });
    if (!ok) return;
    try {
      await evaluationPlansApi.update(plan.id, { format });
      toast.success('Formato actualizado', FORMATS[format].label);
      onChanged();
    } catch (err) {
      toast.error('No se pudo cambiar el formato', getErrorMessage(err));
    }
  };

  const changeTerm = async (termNumber) => {
    if (!termNumber || termNumber === plan.term_number) return;
    const ok = await confirm({
      title: `¿Mover el plan al ${termLabel(termNumber)}?`,
      message: `Sus actividades${plan.activities.length ? ` (${plan.activities.length})` : ''} y las notas ya cargadas pasan a contar en el ${termLabel(termNumber)}. Revisa luego las fechas de aplicación.`,
      confirmLabel: 'Cambiar lapso',
    });
    if (!ok) return;
    try {
      await evaluationPlansApi.update(plan.id, { termNumber });
      toast.success('Lapso actualizado', `${plan.subject} · ${termLabel(termNumber)}`);
      onChanged();
    } catch (err) {
      toast.error('No se pudo cambiar el lapso', getErrorMessage(err));
    }
  };

  return (
    <div className="plan-settings">
      <div className="plan-settings__term">
        <label className="student-card__label" htmlFor="plan-term">
          Lapso académico
        </label>
        <TermSelect id="plan-term" value={plan.term_number} onChange={changeTerm} disabled={!canEdit || plan.status === 'closed'} required />
        <span className="form-hint">Las actividades de este plan se califican en este lapso.</span>
      </div>
      <div>
        <span className="student-card__label">Tipo de formato</span>
        <FormatPicker value={plan.format} onChange={changeFormat} disabled={!canEdit || plan.status === 'closed'} />
      </div>
      <div>
        <span className="student-card__label">Secciones del plan</span>
        <div className="chip-list plan-settings__sections">
          {plan.sections.map((s) => (
            <span key={s.id} className="chip">
              {plan.grade_name} {s.name}
              {s.is_main && sectionsTitle(plan) && <small> · principal</small>}
            </span>
          ))}
          {canEdit && (plan.available_sections.length > 0 || plan.sections.length > 1) && (
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditingSections(true)}>
              Editar secciones
            </Button>
          )}
          {/* Plan creado en la sección equivocada: se puede mover mientras no tenga notas. */}
          {canEdit && !plan.has_grades && plan.move_targets?.length > 0 && (
            <Button size="sm" variant="ghost" icon="arrowRight" onClick={() => setMoving(true)}>
              Mover a otra sección
            </Button>
          )}
        </div>
        <span className="form-hint">El plan se redacta una vez y se aplica a todas sus secciones; las notas siguen siendo por alumno.</span>
      </div>
      {editingSections && <SectionsModal plan={plan} onClose={() => setEditingSections(false)} onSaved={onChanged} />}
      {moving && <MoveSectionModal plan={plan} onClose={() => setMoving(false)} onSaved={onChanged} />}
    </div>
  );
}

const sectionsTitle = (plan) => plan.sections.length > 1;

/**
 * Mueve el plan (con sus actividades) a otra sección del mismo año: para
 * corregir un plan creado en la sección equivocada. Solo sin notas cargadas.
 */
function MoveSectionModal({ plan, onClose, onSaved }) {
  const [target, setTarget] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const chosen = plan.move_targets.find((s) => s.id === target);
  const current = plan.sections.map((s) => `${plan.grade_name} ${s.name}`).join(', ');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await evaluationPlansApi.update(plan.id, { moveToSectionId: target });
      toast.success('Plan movido', `${plan.subject} ahora es de ${chosen.grade_name} · Sección ${chosen.name}.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Mover el plan a otra sección" onClose={onClose}>
      <p style={{ marginTop: -6 }} className="text-sm">
        Hoy el plan de <strong>{plan.subject}</strong> está en <strong>{current}</strong>. Pásalo a la sección correcta: conserva sus actividades y
        ponderaciones, y lo verán los alumnos y representantes de esa sección. Solo es posible mientras no tenga notas cargadas.
      </p>
      <Alert>{error}</Alert>
      <Field label="Sección destino" required hint="Solo aparecen secciones de este año cuyo grado incluye la materia.">
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus aria-label="Sección destino">
          <option value="">Elige la sección…</option>
          {plan.move_targets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.grade_name} · Sección {s.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} loading={saving} disabled={!target}>
          Mover plan
        </Button>
      </div>
    </Modal>
  );
}

function SectionsModal({ plan, onClose, onSaved }) {
  const all = [...plan.sections, ...plan.available_sections.map((s) => ({ ...s, is_main: false }))].sort((a, b) => a.name.localeCompare(b.name));
  const [selected, setSelected] = useState(new Set(plan.sections.map((s) => s.id)));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await evaluationPlansApi.update(plan.id, { sectionIds: [plan.section_id, ...[...selected].filter((id) => id !== plan.section_id)] });
      toast.success('Secciones actualizadas');
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Secciones del plan" onClose={onClose}>
      <p style={{ marginTop: -6 }} className="text-sm">
        Elige a qué secciones de {plan.grade_name} se aplica el plan. El docente de la materia debe ser el mismo en todas. No se puede quitar
        una sección cuyos alumnos ya tengan notas.
      </p>
      <Alert>{error}</Alert>
      <ul className="currency-options">
        {all.map((s) => (
          <li key={s.id} className={selected.has(s.id) ? 'is-on' : ''}>
            <label className="checkbox-row">
              <input type="checkbox" checked={selected.has(s.id)} disabled={s.is_main} onChange={() => toggle(s.id)} />
              {plan.grade_name} · Sección {s.name}
              {s.is_main && <span className="text-muted text-sm"> (principal)</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} loading={saving}>
          Guardar
        </Button>
      </div>
    </Modal>
  );
}
