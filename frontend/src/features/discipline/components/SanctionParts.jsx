import { useState } from 'react';
import disciplineApi from '../../../api/endpoints/discipline.api';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { termLabel } from '../../evaluation-plans/terms';

/** Gravedad: etiqueta, color e ícono (amarillo leve, rojo grave, rojo oscuro gravísima). */
export const SEVERITIES = {
  leve: { label: 'Leve', icon: 'info', hint: 'Falta menor (retardo, uso del teléfono, uniforme…).' },
  grave: { label: 'Grave', icon: 'alertTriangle', hint: 'Afecta la convivencia (irrespeto, agresión verbal…).' },
  gravisima: { label: 'Gravísima', icon: 'alertCircle', hint: 'Pone en riesgo a otros (agresión física, acoso…).' },
};
export const SEVERITY_KEYS = Object.keys(SEVERITIES);

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);

export function SeverityBadge({ severity }) {
  const s = SEVERITIES[severity];
  if (!s) return null;
  return (
    <span className={`sev-badge sev-badge--${severity}`}>
      <Icon name={s.icon} size={12} /> {s.label}
    </span>
  );
}

/** Totales por gravedad (chips de resumen). */
export function SeverityTotals({ totals }) {
  return (
    <div className="sev-totals">
      {SEVERITY_KEYS.map((k) => (
        <span key={k} className={`sev-total sev-total--${k} ${totals?.[k] ? '' : 'is-zero'}`}>
          <strong>{totals?.[k] || 0}</strong> {SEVERITIES[k].label.toLowerCase()}
          {totals?.[k] === 1 ? '' : 's'}
        </span>
      ))}
    </div>
  );
}

/**
 * Tarjeta de una sanción. `showStudent` para el listado general; `onEdit` /
 * `onDelete` solo si el usuario puede gestionarla.
 */
export function SanctionCard({ sanction: s, showStudent = false, onEdit, onDelete, studentLink }) {
  return (
    <article className={`sanction-card sanction-card--${s.severity}`}>
      <header className="sanction-card__head">
        <SeverityBadge severity={s.severity} />
        <strong className="sanction-card__fault">{s.fault_type}</strong>
        <span className="sanction-card__date">
          <Icon name="calendar" size={13} /> {day(s.occurred_on)}
        </span>
      </header>
      {showStudent && (
        <div className="sanction-card__student">
          {studentLink ? studentLink(s) : `${s.first_name} ${s.last_name}`}
          {s.grade_name && <span className="text-muted"> · {s.grade_name} {s.section_name}</span>}
        </div>
      )}
      <p className="sanction-card__desc">{s.description}</p>
      {s.measure && (
        <p className="sanction-card__measure">
          <strong>Medida:</strong> {s.measure}
        </p>
      )}
      <footer className="sanction-card__foot">
        <span>
          {s.school_period_name}
          {s.term_id ? ` · ${termLabel(s.term_number, s.term_name)}` : ''}
          {!showStudent && s.grade_name ? ` · ${s.grade_name} ${s.section_name}` : ''}
          {s.registered_by_name ? ` · Registró: ${s.registered_by_name}` : ''}
          {s.updated_by_name ? ` · Editó: ${s.updated_by_name}` : ''}
        </span>
        {(onEdit || onDelete) && (
          <span className="sanction-card__actions">
            {onEdit && (
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => onEdit(s)}>
                Editar
              </Button>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(s)}>
                Eliminar
              </Button>
            )}
          </span>
        )}
      </footer>
    </article>
  );
}

/**
 * Registrar o editar una sanción. Para registrar desde el módulo general se
 * pasa `students` (para elegir al alumno); desde la ficha, `studentId` fijo.
 */
export function SanctionFormModal({ initial, studentId: fixedStudentId, students, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    studentId: fixedStudentId || initial?.student_id || '',
    severity: initial?.severity || 'leve',
    faultType: initial?.fault_type || '',
    description: initial?.description || '',
    measure: initial?.measure || '',
    occurredOn: initial?.occurred_on || today(),
    termNumber: initial?.term_number || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) =>
    isEdit ? disciplineApi.update(initial.id, data) : disciplineApi.create(form.studentId, data)
  );

  const submit = async (e) => {
    e.preventDefault();
    const data = {
      severity: form.severity,
      faultType: form.faultType,
      description: form.description,
      measure: form.measure || null,
      occurredOn: form.occurredOn,
      ...(form.termNumber ? { termNumber: Number(form.termNumber) } : {}),
    };
    try {
      await run(data);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar sanción' : 'Registrar sanción'} onClose={onClose}>
      <Alert>{error}</Alert>
      <form onSubmit={submit} className="sanction-form">
        {students && !isEdit && (
          <Field label="Alumno" error={fieldErrors.studentId} required>
            <Select sorted value={form.studentId} onChange={set('studentId')} required>
              <option value="">Selecciona…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.first_name} {s.last_name}
                  {s.grade_name ? ` · ${s.grade_name} ${s.section_name}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Gravedad" error={fieldErrors.severity} required>
          <div className="sev-picker" role="radiogroup" aria-label="Gravedad">
            {SEVERITY_KEYS.map((k) => (
              <label key={k} className={`sev-picker__option sev-picker__option--${k} ${form.severity === k ? 'is-selected' : ''}`}>
                <input type="radio" name="severity" value={k} checked={form.severity === k} onChange={set('severity')} />
                <SeverityBadge severity={k} />
                <span className="text-sm text-muted">{SEVERITIES[k].hint}</span>
              </label>
            ))}
          </div>
        </Field>

        <div className="form-grid">
          <Field label="Tipo de falta" error={fieldErrors.faultType} required>
            <Input value={form.faultType} onChange={set('faultType')} maxLength={120} placeholder="Ej. Agresión verbal" required />
          </Field>
          <Field label="Fecha" error={fieldErrors.occurredOn} required>
            <Input type="date" value={form.occurredOn} max={today()} onChange={set('occurredOn')} required />
          </Field>
        </div>
        <Field label="Motivo / detalle" error={fieldErrors.description} required>
          <textarea className="input" rows={3} maxLength={2000} value={form.description} onChange={set('description')} placeholder="Qué ocurrió, dónde y con quién." required />
        </Field>
        <div className="form-grid">
          <Field label="Medida aplicada" hint="Opcional. Ej. amonestación escrita, citación al representante.">
            <Input value={form.measure} onChange={set('measure')} maxLength={200} />
          </Field>
          <Field label="Lapso" hint="Opcional: si no lo eliges, se toma el lapso de la fecha.">
            <Select value={form.termNumber} onChange={set('termNumber')}>
              <option value="">Según la fecha</option>
              <option value="1">Lapso I</option>
              <option value="2">Lapso II</option>
              <option value="3">Lapso III</option>
            </Select>
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!form.studentId}>
            {isEdit ? 'Guardar cambios' : 'Registrar sanción'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
