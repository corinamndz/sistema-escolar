import { useState } from 'react';
import programmaticContentApi from '../../../api/endpoints/programmaticContent.api';
import { useMutation } from '../../../hooks/useMutation';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import { useToast } from '../../../components/ui/Toast';

/**
 * Alta o edición de un tema del contenido programático: Unidad, Tema y
 * Descripción del contenido (los tres obligatorios). La unidad sugiere las ya
 * usadas en la materia para no escribirla distinto cada vez.
 */
function ContentItemModal({ initial, pair, units, defaultUnit, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    unit: initial?.unit || defaultUnit || '',
    topic: initial?.topic || '',
    description: initial?.description || '',
  });
  const { run, loading, error, fieldErrors } = useMutation(
    isEdit ? (data) => programmaticContentApi.update(initial.id, data) : (data) => programmaticContentApi.create({ ...data, gradeId: pair.gradeId, subjectId: pair.subjectId })
  );
  const toast = useToast();
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const filled = form.unit.trim() && form.topic.trim() && form.description.trim();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!filled) return;
    try {
      await run({ unit: form.unit.trim(), topic: form.topic.trim(), description: form.description.trim() });
      toast.success(isEdit ? 'Tema actualizado' : 'Tema agregado', `${form.unit.trim()} · ${form.topic.trim()}`);
      onSaved();
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <Modal title={isEdit ? 'Editar tema' : 'Nuevo tema del contenido programático'} onClose={onClose}>
      <p className="text-sm text-muted pc-modal-context">
        {pair.subjectName} · {pair.gradeName}
      </p>
      <Alert>{error}</Alert>
      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <Field label="Unidad" error={fieldErrors.unit} required hint="Ej. Unidad I, Unidad II.">
            <Input value={form.unit} onChange={set('unit')} list="pc-units" maxLength={100} placeholder="Unidad I" required autoFocus={!isEdit} />
            <datalist id="pc-units">
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field label="Tema" error={fieldErrors.topic} required>
            <Input value={form.topic} onChange={set('topic')} maxLength={200} placeholder="Ej. Estructura celular" required />
          </Field>
          <Field label="Descripción del contenido" error={fieldErrors.description} required full hint="Los puntos que se tratarán en el tema.">
            <textarea
              className="input"
              rows={5}
              maxLength={4000}
              value={form.description}
              onChange={set('description')}
              placeholder="Ej.: Membrana plasmática, citoplasma y núcleo. Diferencias entre célula animal y vegetal."
              required
            />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!filled}>
            {isEdit ? 'Guardar cambios' : 'Agregar tema'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default ContentItemModal;
