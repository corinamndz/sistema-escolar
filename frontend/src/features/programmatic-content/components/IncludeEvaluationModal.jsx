import { useState } from 'react';
import evaluationPlansApi from '../../../api/endpoints/evaluationPlans.api';
import { getErrorMessage } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import { useToast } from '../../../components/ui/Toast';
import { TERM_OPTIONS, termLabel } from '../../evaluation-plans/terms';
import { CriteriaEditor, FormatPicker, detailedBody, detailedFormFrom } from '../../evaluation-plans/components/DetailedPlanner';
import { INSTRUMENT_LABELS } from '../../evaluation-plans/instruments';
import { CATEGORY_LABELS } from '../categories';

const NEW_PLAN = 'new';
const round2 = (n) => Math.round(n * 100) / 100;

/** "Lapso I · Secc. A, B · 60% usado" para el selector de plan. */
const planLabel = (p) =>
  `${termLabel(p.term_number, p.term_name)} · Secc. ${p.section_names} · ${p.teacher_name} · ${p.total_weight}% usado${p.format === 'detailed' ? ' · detallado' : ''}${p.status === 'closed' ? ' (cerrado)' : ''}`;

/**
 * Incluir una evaluación para un tema del contenido programático: la actividad
 * se agrega a un plan de evaluación de la materia en ese grado (uno existente o
 * uno nuevo, eligiendo lapso y secciones) y queda vinculada al tema. Un mismo
 * tema puede tener varias (un taller y un examen, por ejemplo).
 *
 * Formato:
 *   Simple     actividad, tipo, porcentaje, fecha y descripción.
 *   Detallado  además instrumento (rúbrica, escala de estimación…), estrategia,
 *              puntaje, criterios con indicadores y puntos (deben sumar el
 *              puntaje) y fecha de aplicación por sección. Si el plan elegido
 *              es simple, pasa a detallado al guardar (en la misma operación).
 */
function IncludeEvaluationModal({ item, content, onClose, onSaved }) {
  const toast = useToast();
  const openPlans = content.plans.filter((p) => p.status !== 'closed' && p.total_weight < 100);
  const firstPlan = openPlans[0] || null;
  const [planId, setPlanId] = useState(firstPlan?.id || NEW_PLAN);
  const [format, setFormat] = useState(firstPlan?.format || 'simple');
  const [newPlan, setNewPlan] = useState({ termNumber: 1, sectionIds: content.sections.length === 1 ? [content.sections[0].id] : [] });
  const [form, setForm] = useState({ title: '', category: 'formative', weightPercent: '', plannedDate: '', description: '' });
  const [detail, setDetail] = useState(() => ({ ...detailedFormFrom({}, []), instrument: '' }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setD = (key) => (e) => setDetail((d) => ({ ...d, [key]: e.target.value }));

  const plan = content.plans.find((p) => p.id === planId);
  const detailed = format === 'detailed';
  // Secciones a las que se aplica la actividad: las del plan elegido o las marcadas para el plan nuevo.
  const sections = plan ? plan.sections : content.sections.filter((s) => newPlan.sectionIds.includes(s.id));
  const remaining = plan ? round2(100 - plan.total_weight) : 100;
  const typed = form.weightPercent === '' ? null : Number(form.weightPercent);
  const weightError = typed === null ? null : !(typed > 0) ? 'Debe ser mayor que 0.' : typed > remaining ? `Excede lo disponible en el plan (${remaining}%).` : null;
  const needsSections = planId === NEW_PLAN && newPlan.sectionIds.length === 0;
  const canSave = form.title.trim() && typed && !weightError && !needsSections;

  // Al cambiar de plan, el formato sugerido es el del plan (uno detallado sigue en detallado).
  const choosePlan = (id) => {
    setPlanId(id);
    const p = content.plans.find((x) => x.id === id);
    if (p) setFormat(p.format);
  };
  const toggleSection = (id) =>
    setNewPlan((p) => ({ ...p, sectionIds: p.sectionIds.includes(id) ? p.sectionIds.filter((x) => x !== id) : [...p.sectionIds, id] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    let extra = {};
    if (detailed) {
      // Solo las fechas de las secciones de la actividad (pudo cambiar el plan elegido).
      const sectionIds = new Set(sections.map((s) => s.id));
      const result = detailedBody({ ...detail, contentRefs: [], sectionDates: Object.fromEntries(Object.entries(detail.sectionDates).filter(([id]) => sectionIds.has(id))) });
      if (result.error) return setError(result.error);
      if (!result.body.criteria.length) return setError('El formato detallado requiere al menos un criterio con sus indicadores.');
      const { contentRefs: _refs, ...body } = result.body;
      extra = { ...body, instrument: detail.instrument || null, planFormat: 'detailed' };
    }
    setSaving(true);
    setError(null);
    try {
      let targetId = planId;
      if (planId === NEW_PLAN) {
        const created = await evaluationPlansApi.create({
          sectionIds: newPlan.sectionIds,
          termNumber: Number(newPlan.termNumber),
          subjectId: content.subject_id,
          format,
        });
        targetId = created.id;
      }
      await evaluationPlansApi.createActivity(targetId, {
        title: form.title.trim(),
        category: form.category,
        weightPercent: typed,
        plannedDate: form.plannedDate,
        description: form.description.trim(),
        programmaticContentId: item.id,
        ...extra,
      });
      toast.success('Evaluación incluida', `${form.title.trim()} · ${item.topic}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <Modal title="Incluir evaluación" onClose={onClose} size="lg">
      <div className="pc-include-topic">
        <span className="pc-unit-chip">{item.unit}</span>
        <strong>{item.topic}</strong>
      </div>
      <form onSubmit={handleSubmit}>
        <Field label="Formato de la evaluación">
          <FormatPicker value={format} onChange={setFormat} />
        </Field>
        {detailed && plan && plan.format !== 'detailed' && (
          <Alert variant="info">
            El plan {termLabel(plan.term_number, plan.term_name)} · Secc. {plan.section_names} pasará a formato detallado al guardar. Sus actividades actuales se conservan.
          </Alert>
        )}
        <Alert>{error}</Alert>
        <div className="form-grid">
          <Field label="Plan de evaluación" full hint="La actividad suma al plan del lapso y las secciones que elijas.">
            <Select value={planId} onChange={(e) => choosePlan(e.target.value)}>
              {content.plans.map((p) => (
                <option key={p.id} value={p.id} disabled={p.status === 'closed' || p.total_weight >= 100}>
                  {planLabel(p)}
                </option>
              ))}
              <option value={NEW_PLAN} disabled={content.sections.length === 0}>
                + Nuevo plan de evaluación…
              </option>
            </Select>
          </Field>
          {planId === NEW_PLAN && (
            <>
              <Field label="Lapso">
                <Select value={newPlan.termNumber} onChange={(e) => setNewPlan((p) => ({ ...p, termNumber: e.target.value }))}>
                  {TERM_OPTIONS.map((t) => (
                    <option key={t.number} value={t.number}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Secciones" error={needsSections ? 'Elige al menos una sección.' : null}>
                <div className="pc-sections">
                  {content.sections.map((s) => (
                    <label key={s.id} className="checkbox-row">
                      <input type="checkbox" checked={newPlan.sectionIds.includes(s.id)} onChange={() => toggleSection(s.id)} />
                      Sección {s.name}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}
          <Field label={detailed ? 'Actividad o instrumento' : 'Actividad'} required full>
            <Input value={form.title} onChange={set('title')} maxLength={200} placeholder="Ej. Taller de la célula, Examen práctico" required />
          </Field>
          <Field label="Tipo">
            <Select value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Porcentaje de la nota" required error={weightError} hint={`Disponible en el plan: ${remaining}%`}>
            <Input type="number" min="0.01" max="100" step="0.01" suffix="%" value={form.weightPercent} onChange={set('weightPercent')} error={weightError} required />
          </Field>
          {!detailed && (
            <Field label="Fecha estimada" hint="Opcional; dentro del lapso.">
              <Input type="date" value={form.plannedDate} onChange={set('plannedDate')} />
            </Field>
          )}
          <Field label="Descripción" full hint="Opcional: instrucciones o criterios generales.">
            <textarea className="input" rows={2} maxLength={1000} value={form.description} onChange={set('description')} />
          </Field>
        </div>

        {detailed && (
          <div className="pc-detailed">
            <h4 className="pc-detailed__title">Evaluación detallada</h4>
            <div className="form-grid">
              <Field label="Instrumento de evaluación" hint="Opcional.">
                <Select value={detail.instrument} onChange={setD('instrument')}>
                  <option value="">Sin especificar</option>
                  {Object.entries(INSTRUMENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Estrategia evaluativa" hint="Ej.: trabajo en parejas, actividad individual.">
                <Input value={detail.strategy} onChange={setD('strategy')} maxLength={200} />
              </Field>
              <Field label="Puntaje de la actividad" required hint="Los indicadores deben sumar este puntaje (ej. 20).">
                <Input inputMode="decimal" value={detail.maxScore} onChange={setD('maxScore')} suffix="pts" required />
              </Field>
              <Field label="Criterios e indicadores de logro" required full hint="Cada criterio con sus indicadores y el puntaje de cada uno.">
                <CriteriaEditor value={detail.criteria} onChange={(criteria) => setDetail((d) => ({ ...d, criteria }))} maxScore={detail.maxScore} />
              </Field>
              <Field label="Fechas de aplicación" full hint={sections.length ? 'Opcional; dentro del lapso.' : 'Elige las secciones del plan para indicar sus fechas.'}>
                <div className="section-dates">
                  {sections.map((s) => (
                    <label key={s.id} className="section-dates__item">
                      <span>Sección {s.name}</span>
                      <Input
                        type="date"
                        value={detail.sectionDates[s.id] || ''}
                        onChange={(e) => setDetail((d) => ({ ...d, sectionDates: { ...d.sectionDates, [s.id]: e.target.value } }))}
                        aria-label={`Fecha de aplicación en la sección ${s.name}`}
                      />
                    </label>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        )}

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving} disabled={!canSave}>
            Incluir evaluación
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default IncludeEvaluationModal;
