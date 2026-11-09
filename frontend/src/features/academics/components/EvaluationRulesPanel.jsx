import { useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useMutation } from '../../../hooks/useMutation';
import Button from '../../../components/ui/Button';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { termLabel } from '../../evaluation-plans/terms';

const fmt = (n) => Number(n).toLocaleString('es', { maximumFractionDigits: 2 });

const POLICY_LABEL = {
  evaluated_terms: 'Si faltan períodos: promedio provisional de los que tienen nota',
  all_terms_closed: 'Si faltan períodos: sin promedio hasta tenerlos todos con nota y cerrados',
};

/** Texto corto del cálculo del promedio anual de una materia. */
function averageLabel(rules) {
  const n = rules.terms.length;
  if (rules.effective_mode === 'weighted') {
    return `Promedio ponderado de ${n} períodos (${rules.terms.map((t) => `${termLabel(t.term_number, t.name)} ${fmt(t.weight_percent)}%`).join(' · ')})`;
  }
  return n ? `Promedio aritmético de ${n} período${n === 1 ? '' : 's'}` : 'Promedio de los períodos';
}

/**
 * Normativa de evaluación del año que finaliza: con qué nota se aprueba una
 * materia, cómo se promedian sus períodos y cuántas materias reprobadas se
 * permiten para promover. La sugerencia de cada alumno sale de aquí.
 */
function EvaluationRulesPanel({ period, rules, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rules-panel">
      <div className="rules-panel__icon">
        <Icon name="clipboard" size={18} />
      </div>
      <div className="rules-panel__body">
        <strong>Normativa de evaluación · {period.name}</strong>
        <ul className="rules-panel__list">
          <li>
            Materia aprobada con <b>{fmt(rules.passing_grade)}/20</b> o más
          </li>
          <li>{averageLabel(rules)}</li>
          <li>
            Promueve con hasta <b>{rules.max_failed_subjects}</b> materia{rules.max_failed_subjects === 1 ? '' : 's'} reprobada{rules.max_failed_subjects === 1 ? '' : 's'}
          </li>
          <li>{POLICY_LABEL[rules.incomplete_average_policy] || POLICY_LABEL.evaluated_terms}</li>
          <li>{rules.grade_rounding === 'integer' ? 'Notas redondeadas al entero (9,5 → 10)' : 'Notas con decimales, sin redondeo'}</li>
        </ul>
        {rules.warning && <span className="text-sm text-warning">{rules.warning}</span>}
      </div>
      {canEdit && (
        <Button size="sm" variant="secondary" icon="pencil" onClick={() => setEditing(true)}>
          Editar normativa
        </Button>
      )}
      {editing && (
        <RulesModal
          period={period}
          rules={rules}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

function RulesModal({ period, rules, onClose, onSaved }) {
  const [form, setForm] = useState({
    passingGrade: rules.passing_grade,
    maxFailedSubjects: rules.max_failed_subjects,
    termAverageMode: rules.term_average_mode,
    gradeRounding: rules.grade_rounding,
    incompleteAveragePolicy: rules.incomplete_average_policy || 'evaluated_terms',
    weights: Object.fromEntries(rules.terms.map((t) => [t.id, t.weight_percent ?? (rules.terms.length ? Math.round((100 / rules.terms.length) * 100) / 100 : '')])),
  });
  const { run, loading, error, fieldErrors } = useMutation((data) => academicsApi.updateEvaluationRules(period.id, data));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const weighted = form.termAverageMode === 'weighted';
  const weightSum = Math.round(rules.terms.reduce((n, t) => n + (Number(form.weights[t.id]) || 0), 0) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    try {
      await run({
        passingGrade: Number(form.passingGrade),
        maxFailedSubjects: Number(form.maxFailedSubjects),
        termAverageMode: form.termAverageMode,
        gradeRounding: form.gradeRounding,
        incompleteAveragePolicy: form.incompleteAveragePolicy,
        termWeights: rules.terms.map((t) => ({ termId: t.id, weightPercent: form.weights[t.id] === '' ? null : Number(form.weights[t.id]) })),
      });
      onSaved();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Drawer title={`Normativa de evaluación · ${period.name}`} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={submit} className="rules-form">
        <div className="form-grid">
          <Field label="Nota mínima aprobatoria (sobre 20)" error={fieldErrors.passingGrade} required>
            <Input type="number" min="1" max="20" step="0.01" value={form.passingGrade} onChange={(e) => set({ passingGrade: e.target.value })} required />
          </Field>
          <Field label="Materias reprobadas permitidas" hint="Con este número o menos, el alumno promueve con materia pendiente." error={fieldErrors.maxFailedSubjects} required>
            <Input type="number" min="0" max="20" value={form.maxFailedSubjects} onChange={(e) => set({ maxFailedSubjects: e.target.value })} required />
          </Field>
          <Field label="Promedio anual de cada materia" required>
            <Select value={form.termAverageMode} onChange={(e) => set({ termAverageMode: e.target.value })}>
              <option value="arithmetic">Aritmético (÷ {rules.terms.length} período{rules.terms.length === 1 ? '' : 's'})</option>
              <option value="weighted">Ponderado (con pesos)</option>
            </Select>
          </Field>
          <Field
            label="Si faltan períodos por evaluar"
            hint={
              form.incompleteAveragePolicy === 'all_terms_closed'
                ? 'Sin promedio hasta que todos tengan nota y estén cerrados.'
                : 'Promedio provisional con los que tienen nota; un período sin evaluar no cuenta como 0.'
            }
            error={fieldErrors.incompleteAveragePolicy}
            required
          >
            <Select value={form.incompleteAveragePolicy} onChange={(e) => set({ incompleteAveragePolicy: e.target.value })}>
              <option value="evaluated_terms">Promediar los evaluados</option>
              <option value="all_terms_closed">Esperar todos cerrados</option>
            </Select>
          </Field>
          <Field label="Redondeo" required>
            <Select value={form.gradeRounding} onChange={(e) => set({ gradeRounding: e.target.value })}>
              <option value="none">Sin redondeo (12,35)</option>
              <option value="integer">Al entero: 9,5 → 10 · 9,4 → 9</option>
            </Select>
          </Field>
        </div>

        {weighted && (
          <div className="rules-form__weights">
            <span className="student-card__label">Peso de cada período</span>
            {rules.terms.length === 0 ? (
              <Alert variant="warning">El año no tiene períodos registrados.</Alert>
            ) : (
              <>
                <div className="rules-form__weights-row">
                  {rules.terms.map((t) => (
                    <label key={t.id}>
                      <span className="text-sm">{termLabel(t.term_number, t.name)}</span>
                      <Input type="number" min="0" max="100" step="0.01" value={form.weights[t.id]} onChange={(e) => set({ weights: { ...form.weights, [t.id]: e.target.value } })} />
                    </label>
                  ))}
                </div>
                <span className={`text-sm ${weightSum === 100 ? 'text-muted' : 'text-danger'}`}>Total: {fmt(weightSum)}% {weightSum === 100 ? '' : '(debe sumar 100%)'}</span>
              </>
            )}
            {fieldErrors.termWeights && <span className="field-error">{fieldErrors.termWeights}</span>}
          </div>
        )}

        <p className="text-sm text-muted">
          Se aplica a las sugerencias de promoción y al historial de los alumnos que aún cursan {period.name}. Los ya procesados conservan la normativa con la que se decidieron.
        </p>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={weighted && weightSum !== 100}>
            Guardar normativa
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default EvaluationRulesPanel;
