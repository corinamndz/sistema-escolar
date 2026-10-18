import { useEffect, useMemo, useState } from 'react';
import appointmentsApi from '../../../api/endpoints/appointments.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import StudentPicker from '../../students/components/StudentPicker';
import { APPOINTMENT_STATUSES, STATUS_KEYS, notifiedText } from '../appointmentCatalog';

const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

const GUARDIAN_LABELS = { list: 'Representantes', clear: 'Quitar representante elegido', empty: 'Ningún representante coincide con' };

/**
 * Agendar o editar una cita con un representante: a quién (y sobre qué
 * alumno), cuándo, dónde, el motivo, el estado y por qué canales avisarle.
 * Los canales vienen marcados según Configuración → Notificaciones.
 */
function AppointmentFormModal({ initial, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const toast = useToast();
  const { data: options, loading: loadingOptions, error: optionsError } = useFetch(() => appointmentsApi.options(), []);
  const [form, setForm] = useState({
    guardianId: initial?.guardian_id || '',
    studentId: initial?.student_id || '',
    meetingDate: initial?.meeting_date || '',
    startTime: initial?.start_time || '',
    endTime: initial?.end_time || '',
    location: initial?.location || '',
    topic: initial?.topic || '',
    notes: initial?.notes || '',
    status: initial?.status || 'pending',
    notifyBell: initial?.notify_bell ?? null,
    notifyEmail: initial?.notify_email ?? null,
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) => (isEdit ? appointmentsApi.update(initial.id, data) : appointmentsApi.create(data)));

  // Cita nueva: los canales empiezan como los define el colegio para este aviso.
  useEffect(() => {
    if (!options || isEdit) return;
    setForm((f) => ({
      ...f,
      notifyBell: f.notifyBell ?? options.notify_defaults.bell,
      notifyEmail: f.notifyEmail ?? (options.notify_defaults.email && options.email_ready),
    }));
  }, [options, isEdit]);

  // El picker muestra al representante con sus representados como segunda línea.
  const guardians = useMemo(
    () =>
      (options?.guardians || []).map((g) => ({
        ...g,
        grade_name: g.students.length ? `Representa a: ${g.students.map((s) => s.name).join(', ')}` : 'Sin alumnos vinculados',
      })),
    [options]
  );
  const guardian = guardians.find((g) => g.id === form.guardianId) || null;

  const chooseGuardian = (id) => {
    const g = guardians.find((x) => x.id === id);
    // Con un solo representado, queda elegido; si el alumno elegido no es suyo, se limpia.
    setForm((f) => ({
      ...f,
      guardianId: id,
      studentId: g?.students.length === 1 ? g.students[0].id : g?.students.some((s) => s.id === f.studentId) ? f.studentId : '',
    }));
  };

  const timeError = form.startTime && form.endTime && form.endTime <= form.startTime ? 'Debe ser posterior a la hora de inicio.' : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (timeError) return;
    try {
      const saved = await run({
        guardianId: form.guardianId,
        studentId: form.studentId || null,
        meetingDate: form.meetingDate,
        startTime: form.startTime,
        endTime: form.endTime || null,
        location: form.location.trim(),
        topic: form.topic.trim(),
        notes: form.notes.trim(),
        status: form.status,
        notifyBell: Boolean(form.notifyBell),
        notifyEmail: Boolean(form.notifyEmail),
      });
      toast.success(isEdit ? 'Cita actualizada' : 'Cita agendada', notifiedText(saved.notified) || saved.topic);
      onSaved(saved);
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar cita' : 'Agendar cita con representante'} onClose={onClose} size="lg">
      <Alert>{optionsError || error}</Alert>
      {loadingOptions ? (
        <Spinner />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Representante" required full error={fieldErrors.guardianId} hint={`${guardians.length} representantes · busca por nombre, cédula o alumno`}>
              <StudentPicker
                students={guardians}
                value={form.guardianId}
                onChange={chooseGuardian}
                required
                autoFocus={!isEdit}
                invalid={Boolean(fieldErrors.guardianId)}
                placeholder="Escribe el nombre, la cédula o el alumno…"
                labels={GUARDIAN_LABELS}
              />
            </Field>
            <Field label="Alumno" full error={fieldErrors.studentId} hint={guardian && !guardian.students.length ? 'Este representante no tiene alumnos vinculados.' : 'Opcional: el representado del que se va a hablar.'}>
              <Select value={form.studentId} onChange={set('studentId')} disabled={!guardian || !guardian.students.length}>
                <option value="">{guardian ? 'Sin alumno específico' : 'Elige primero al representante'}</option>
                {(guardian?.students || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Fecha" required error={fieldErrors.meetingDate}>
              <Input type="date" value={form.meetingDate} min={isEdit ? undefined : todayStr()} onChange={set('meetingDate')} required />
            </Field>
            <div className="appt-times">
              <Field label="Desde" required error={fieldErrors.startTime}>
                <Input type="time" value={form.startTime} onChange={set('startTime')} required />
              </Field>
              <Field label="Hasta" error={timeError || fieldErrors.endTime} hint="Opcional.">
                <Input type="time" value={form.endTime} onChange={set('endTime')} error={timeError} />
              </Field>
            </div>

            <Field label="Motivo o tema a tratar" required full error={fieldErrors.topic}>
              <Input value={form.topic} onChange={set('topic')} maxLength={200} placeholder="Ej. Rendimiento en Matemáticas del primer lapso" required />
            </Field>
            <Field label="Lugar" error={fieldErrors.location} hint="Opcional.">
              <Input value={form.location} onChange={set('location')} maxLength={150} placeholder="Ej. Dirección, Coordinación…" />
            </Field>
            <Field label="Estado" error={fieldErrors.status}>
              <Select value={form.status} onChange={set('status')}>
                {STATUS_KEYS.map((s) => (
                  <option key={s} value={s}>
                    {APPOINTMENT_STATUSES[s].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Detalle" full error={fieldErrors.notes} hint="Opcional: antecedentes, qué traer o, al concluir, los acuerdos. No se muestra a la familia.">
              <textarea className="input" rows={3} maxLength={2000} value={form.notes} onChange={set('notes')} />
            </Field>

            <Field label="Avisar al representante por" full hint={isEdit ? 'Se vuelve a avisar si cambian la fecha, la hora o el estado (confirmada o cancelada).' : 'El aviso sale al guardar la cita.'}>
              <div className="appt-channels">
                <label className={`appt-channel ${form.notifyBell ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={Boolean(form.notifyBell)} onChange={set('notifyBell')} />
                  <Icon name="bell" size={16} />
                  <span>
                    <strong>Campana del portal</strong>
                    <span className="appt-channel__hint">
                      {guardian && !guardian.has_portal ? 'Este representante aún no tiene acceso al portal.' : 'Aviso en el centro de notificaciones de la familia.'}
                    </span>
                  </span>
                </label>
                <label className={`appt-channel ${form.notifyEmail ? 'is-on' : ''} ${options?.email_ready ? '' : 'is-disabled'}`}>
                  <input type="checkbox" checked={Boolean(form.notifyEmail)} onChange={set('notifyEmail')} disabled={!options?.email_ready} />
                  <Icon name="mail" size={16} />
                  <span>
                    <strong>Correo electrónico</strong>
                    <span className="appt-channel__hint">
                      {!options?.email_ready
                        ? 'El correo del colegio no está configurado (Configuración → Correo).'
                        : guardian && !guardian.email
                          ? 'Este representante no tiene correo registrado.'
                          : guardian
                            ? `A ${guardian.email}`
                            : 'Al correo registrado del representante.'}
                    </span>
                  </span>
                </label>
              </div>
            </Field>
          </div>

          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading} disabled={!form.guardianId || Boolean(timeError)}>
              {isEdit ? 'Guardar cambios' : 'Agendar cita'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default AppointmentFormModal;
