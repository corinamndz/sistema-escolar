import { useState } from 'react';
import academicsApi from '../../../api/endpoints/academics.api';
import { useMutation } from '../../../hooks/useMutation';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { termLabel } from '../../evaluation-plans/terms';

const fmt = (n) => Number(n).toLocaleString('es', { maximumFractionDigits: 2 });

/** Texto corto del cálculo del promedio anual de una materia. */
function averageLabel(rules) {
  const n = rules.terms.length;
  if (rules.effective_mode === 'weighted') {
    return `Promedio ponderado de ${n} lapsos (${rules.terms.map((t) => `${termLabel(t.term_number, t.name)} ${fmt(t.weight_percent)}%`).join(' · ')})`;
  }
  return n ? `Promedio aritmético de ${n} lapso${n === 1 ? '' : 's'}` : 'Promedio de los lapsos';
}

/**
 * Normativa de evaluación del año que finaliza: con qué nota se aprueba una
 * materia, cómo se promedian sus lapsos y cuántas materias reprobadas se
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
        termWeights: rules.terms.map((t) => ({ termId: t.id, weightPercent: form.weights[t.id] === '' ? null : Number(form.weights[t.id]) })),
      });
      onSaved();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={`Normativa de evaluación · ${period.name}`} onClose={onClose}>
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
              <option value="arithmetic">Aritmético: (L1 + L2 + L3) ÷ 3</option>
              <option value="weighted">Ponderado: cada lapso con su peso</option>
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
            <span className="student-card__label">Peso de cada lapso</span>
            {rules.terms.length === 0 ? (
              <Alert variant="warning">El año no tiene lapsos registrados.</Alert>
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
    </Modal>
  );
}

export default EvaluationRulesPanel;
