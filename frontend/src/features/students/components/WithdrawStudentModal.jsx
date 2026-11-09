import { useState } from 'react';
import studentsApi from '../../../api/endpoints/students.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';

const REASONS = ['Cambio de domicilio', 'Cambio de colegio', 'Motivos económicos', 'Decisión de la familia'];

/** Hoy en la fecha del navegador (no en UTC: de noche en Venezuela, UTC ya es mañana). */
function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Retirar a un alumno del colegio: pide la fecha y el motivo, y explica qué pasa
 * antes de confirmar. Es un retiro lógico: su historial sigue consultable.
 *   student { id, first_name, last_name }
 */
function WithdrawStudentModal({ student, onClose, onDone }) {
  const today = localToday();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const name = `${student.first_name} ${student.last_name}`;

  const submit = async (e) => {
    e.preventDefault();
    if (!date) {
      setErrors({ withdrawnOn: 'Indica la fecha de retiro.' });
      return;
    }
    if (date > today) {
      setErrors({ withdrawnOn: 'La fecha de retiro no puede ser futura.' });
      return;
    }
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await studentsApi.withdraw(student.id, { withdrawnOn: date, reason: reason.trim() || null });
      const n = res.cancelled_tuition;
      toast.success('Alumno retirado', n ? `${name} · ${n === 1 ? '1 mensualidad futura anulada' : `${n} mensualidades futuras anuladas`}` : name);
      onDone();
    } catch (err) {
      setErrors(getFieldErrors(err));
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`¿Retirar a ${name}?`} onClose={saving ? () => {} : onClose}>
      <form onSubmit={submit} noValidate className="adj-form">
        <Alert>{formError}</Alert>
        <ul className="wd-effects">
          <li>
            <Icon name="logout" size={15} /> Sale de su sección, de sus clubes y de las listas de este año.
          </li>
          <li>
            <Icon name="card" size={15} /> Se anulan las mensualidades pendientes de los próximos meses. Las deudas hasta el mes en curso se mantienen.
          </li>
          <li>
            <Icon name="book" size={15} /> Su historial, boletas, notas, planillas y pagos se conservan y se pueden seguir consultando.
          </li>
        </ul>

        <Field label="Fecha de retiro" required error={errors.withdrawnOn}>
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} autoFocus />
        </Field>
        <Field label="Motivo del retiro" error={errors.reason} hint={`Opcional. ${reason.trim().length}/500`}>
          <textarea className="input adj-form__reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: Cambio de domicilio a otro estado" />
        </Field>
        <div className="adj-form__chips" aria-label="Motivos frecuentes">
          {REASONS.map((r) => (
            <button key={r} type="button" className="adj-chip" onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>

        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" icon="logout" loading={saving}>
            Retirar alumno
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default WithdrawStudentModal;
