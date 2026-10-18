import { useMemo, useState } from 'react';
import eventsApi from '../../../api/endpoints/events.api';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Switch from '../../../components/ui/Switch';
import { useToast } from '../../../components/ui/Toast';
import { EDITABLE_CATEGORIES, longDate, todayStr } from '../eventCatalog';

const AUDIENCES = [
  { key: 'school', label: 'Todo el colegio' },
  { key: 'grade', label: 'Un año o grado' },
  { key: 'section', label: 'Una sección' },
];

/**
 * Alta / edición de un evento de la cartelera: título, tipo, lugar, a quién
 * va dirigido, descripción y su FECHA ÚNICA con hora de inicio y (opcional)
 * de fin.
 */
function EventFormModal({ initial = {}, onClose, onSaved }) {
  const isEdit = Boolean(initial.id);
  const toast = useToast();
  const { data: targets } = useFetch(() => eventsApi.audiences(), []);
  const [form, setForm] = useState({
    title: initial.title || '',
    category: initial.category || 'institucional',
    location: initial.location || '',
    description: initial.description || '',
    audience: initial.audience || 'school',
    gradeId: initial.grade_id || '',
    sectionId: initial.section_id || '',
    isPublished: initial.is_published ?? true,
    eventDate: initial.event_date || '',
    startTime: initial.start_time || '',
    endTime: initial.end_time || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { run, loading, error, fieldErrors } = useMutation((data) => (isEdit ? eventsApi.update(initial.id, data) : eventsApi.create(data)));

  // Una sección guardada que ya no está en un año activo se sigue ofreciendo para no perderla al editar.
  const sections = useMemo(() => {
    const list = targets?.sections || [];
    if (initial.section_id && !list.some((s) => s.id === initial.section_id)) {
      return [...list, { id: initial.section_id, name: initial.section_name, grade_name: initial.section_grade_name, school_period_name: initial.school_period_name }];
    }
    return list;
  }, [targets, initial]);

  const timeError = form.endTime && form.startTime && form.endTime <= form.startTime ? 'La hora de fin debe ser posterior a la de inicio.' : null;
  const audienceMissing = (form.audience === 'grade' && !form.gradeId) || (form.audience === 'section' && !form.sectionId);
  const canSubmit = form.title.trim() && form.eventDate && form.startTime && !timeError && !audienceMissing;
  const pastDate = form.eventDate && form.eventDate < todayStr();

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const ev = await run({
        title: form.title,
        category: form.category,
        location: form.location,
        description: form.description,
        audience: form.audience,
        gradeId: form.audience === 'grade' ? form.gradeId : null,
        sectionId: form.audience === 'section' ? form.sectionId : null,
        isPublished: form.isPublished,
        eventDate: form.eventDate,
        startTime: form.startTime,
        endTime: form.endTime || null,
      });
      toast.success(isEdit ? 'Evento actualizado' : form.isPublished ? 'Evento publicado' : 'Borrador guardado', ev.title);
      onSaved(ev);
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? `Editar ${initial.title}` : 'Nuevo evento'} onClose={onClose} size="lg">
      <Alert>{error}</Alert>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Título del evento" error={fieldErrors.title} full required>
            <Input value={form.title} onChange={set('title')} maxLength={150} required autoFocus placeholder="Ej.: Asamblea de padres y representantes" />
          </Field>
          <Field label="Tipo de evento" error={fieldErrors.category}>
            <Select value={form.category} onChange={set('category')}>
              {Object.entries(EDITABLE_CATEGORIES).map(([key, cat]) => (
                <option key={key} value={key}>
                  {cat.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lugar (opcional)" error={fieldErrors.location}>
            <Input value={form.location} onChange={set('location')} maxLength={150} placeholder="Ej.: Patio central" />
          </Field>

          <div className="form-field form-field--full">
            <label>
              Fecha y hora<span className="form-field__required">*</span>
            </label>
            <div className="evt-when">
              <label>
                <span className="text-sm text-muted">Fecha</span>
                <Input type="date" value={form.eventDate} onChange={set('eventDate')} required aria-invalid={Boolean(fieldErrors.eventDate) || undefined} />
              </label>
              <label>
                <span className="text-sm text-muted">Inicio</span>
                <Input type="time" value={form.startTime} onChange={set('startTime')} required aria-invalid={Boolean(fieldErrors.startTime) || undefined} />
              </label>
              <label>
                <span className="text-sm text-muted">Fin (opcional)</span>
                <Input type="time" value={form.endTime} min={form.startTime || undefined} onChange={set('endTime')} aria-invalid={Boolean(timeError || fieldErrors.endTime) || undefined} />
              </label>
            </div>
            {timeError || fieldErrors.endTime || fieldErrors.eventDate || fieldErrors.startTime ? (
              <span className="field-error" role="alert">
                {timeError || fieldErrors.endTime || fieldErrors.eventDate || fieldErrors.startTime}
              </span>
            ) : form.eventDate ? (
              <span className="form-hint">
                <span className="evt-when__long">{longDate(form.eventDate)}</span>
                {pastDate && ' · esta fecha ya pasó: el evento quedará en «anteriores».'}
              </span>
            ) : null}
          </div>

          <Field label="Dirigido a" full error={fieldErrors.gradeId || fieldErrors.sectionId}>
            <div className="evt-audience">
              <div className="segmented" role="radiogroup" aria-label="Dirigido a">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={form.audience === a.key}
                    className={`segmented__item ${form.audience === a.key ? 'segmented__item--active' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, audience: a.key }))}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {form.audience === 'grade' && (
                <Select value={form.gradeId} onChange={set('gradeId')} required aria-label="Año o grado">
                  <option value="">Elige el año o grado…</option>
                  {(targets?.grades || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
              {form.audience === 'section' && (
                <Select value={form.sectionId} onChange={set('sectionId')} required aria-label="Sección">
                  <option value="">Elige la sección…</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.grade_name} · Sección {s.name} ({s.school_period_name})
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <span className="form-hint">
              {form.audience === 'school'
                ? 'Lo verán todas las familias en el portal.'
                : form.audience === 'grade'
                  ? 'Lo verán las familias con hijos en cualquier sección de ese grado.'
                  : 'Lo verán solo las familias con hijos en esa sección.'}
            </span>
          </Field>

          <Field label="Descripción (opcional)" error={fieldErrors.description} full hint="Programa, qué deben traer, vestimenta, recomendaciones… Las tarjetas muestran el comienzo.">
            <textarea className="input" rows={4} maxLength={4000} value={form.description} onChange={set('description')} />
          </Field>
          <div className="form-field form-field--full settings-switch">
            <Switch
              checked={form.isPublished}
              onChange={(isPublished) => setForm((f) => ({ ...f, isPublished }))}
              label="Publicar en el portal de representantes"
              description="Apagado, queda como borrador: solo lo ve la administración."
            />
          </div>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!canSubmit}>
            {isEdit ? 'Guardar cambios' : form.isPublished ? 'Publicar evento' : 'Guardar borrador'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default EventFormModal;
