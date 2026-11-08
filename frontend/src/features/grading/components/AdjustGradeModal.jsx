import { useState } from 'react';
import gradingApi from '../../../api/endpoints/grading.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { literalFor } from '../gradingScale';

const MIN_REASON = 10;
const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const SUGGESTIONS = ['Aprobación en jornada de revisión de notas', 'Recalificación de prueba final', 'Corrección de un error de transcripción'];

/**
 * Ajuste directivo de la definitiva de una materia en un lapso (Administrador o
 * Coordinador del nivel). Pide la nota nueva y un motivo OBLIGATORIO; el
 * servidor lo valida de nuevo y lo deja en el historial de ajustes y en la
 * bitácora de auditoría. Si la nota ya está ajustada, permite quitar el ajuste
 * (vuelve a la calculada), también con motivo.
 *
 *   target  { studentId, studentName, schoolPeriodId, term: { id, name }, subject: { key, name }, cell }
 */
function AdjustGradeModal({ target, scale = 20, passing = 10, qualitative = false, onClose, onSaved }) {
  const { cell } = target;
  const adjusted = cell?.adjustment || null;
  const computed = adjusted ? (cell.computed ?? null) : (cell?.value ?? null);
  const current = cell?.value ?? null;
  const [mode, setMode] = useState('set'); // 'set' | 'revert'
  const [grade, setGrade] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const value = grade === '' ? null : Number(String(grade).replace(',', '.'));
  const reasonLen = reason.trim().length;
  const literal = qualitative && value !== null && Number.isFinite(value) ? literalFor(value) : null;

  const save = async (e) => {
    e.preventDefault();
    const local = {};
    if (mode === 'set') {
      if (value === null || !Number.isFinite(value)) local.newGrade = 'Escribe la nota nueva.';
      else if (value < 0 || value > scale) local.newGrade = `Entre 0 y ${scale}.`;
    }
    if (reasonLen < MIN_REASON) local.reason = `Explica el motivo (al menos ${MIN_REASON} caracteres).`;
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    setFormError(null);
    try {
      const detail = await gradingApi.adjustGrade(target.studentId, {
        schoolPeriodId: target.schoolPeriodId,
        termId: target.term.id,
        subjectKey: target.subject.key,
        newGrade: mode === 'revert' ? null : Math.round(value * 100) / 100,
        reason: reason.trim(),
      });
      toast.success(mode === 'revert' ? 'Ajuste quitado' : 'Nota ajustada', `${target.subject.name} · ${target.term.name}: queda registrado en el historial.`);
      onSaved(detail);
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Ajustar calificación definitiva" onClose={saving ? () => {} : onClose}>
      <form onSubmit={save} noValidate className="adj-form">
        <div className="adj-form__who">
          <strong>{target.subject.name}</strong>
          <span>
            {target.term.name} · {target.studentName}
          </span>
        </div>
        <dl className="adj-form__now">
          <div>
            <dt>Calculada por el sistema</dt>
            <dd>{fmt(computed)}</dd>
          </div>
          <div>
            <dt>Vigente</dt>
            <dd className={current !== null && current < passing ? 'is-fail' : undefined}>
              {fmt(current)}
              {adjusted && <span className="adj-tag">Ajustada</span>}
            </dd>
          </div>
        </dl>

        {adjusted && (
          <div className="segmented adj-form__mode" role="radiogroup" aria-label="Acción">
            {[
              ['set', 'Cambiar la nota'],
              ['revert', 'Quitar el ajuste'],
            ].map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} className={`segmented__item ${mode === k ? 'segmented__item--active' : ''}`} onClick={() => setMode(k)}>
                {label}
              </button>
            ))}
          </div>
        )}

        <Alert>{formError}</Alert>
        {mode === 'set' ? (
          <Field label={`Nueva nota definitiva (0 a ${scale})`} required error={errors.newGrade} hint={literal ? `Equivale al literal ${literal.code} · ${literal.label}` : `Se aprueba con ${passing}.`}>
            <Input type="number" inputMode="decimal" min={0} max={scale} step="0.01" value={grade} onChange={(e) => setGrade(e.target.value)} autoFocus />
          </Field>
        ) : (
          <p className="adj-form__revert">
            <Icon name="refresh" size={15} /> La nota vuelve a la calculada por el sistema: <strong>{fmt(computed)}</strong>.
          </p>
        )}

        <Field label="Comentario / motivo del ajuste" required error={errors.reason} hint={`${reasonLen}/500 · mínimo ${MIN_REASON} caracteres. Queda en el historial con tu nombre y la fecha.`}>
          <textarea className="input adj-form__reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: Aprobación en jornada de revisión de notas" />
        </Field>
        <div className="adj-form__chips" aria-label="Motivos frecuentes">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="adj-chip" onClick={() => setReason(s)}>
              {s}
            </button>
          ))}
        </div>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" icon={mode === 'revert' ? 'refresh' : 'check'} loading={saving} disabled={reasonLen < MIN_REASON}>
            {mode === 'revert' ? 'Quitar ajuste' : 'Guardar ajuste'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default AdjustGradeModal;
