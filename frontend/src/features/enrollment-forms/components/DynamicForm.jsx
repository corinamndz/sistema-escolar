import { useEffect, useRef, useState } from 'react';
import Field from '../../../components/ui/Field';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/ui/Icon';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

/**
 * Formulario dinámico: dibuja una planilla a partir de su esquema JSON
 * (lista de campos) — el mismo componente para la vista previa del diseñador,
 * el portal del representante y la revisión de la administración.
 *
 *   fields    [{ id, type, label, help?, required?, placeholder?, options? }]
 *   values    { <id>: valor }
 *   onChange  (id, valor) => void   (sin onChange / readOnly: solo lectura)
 *   errors    { <id>: mensaje }
 *   marks     { <id>: 'record' | 'previous' }  campos precargados (re-inscripción)
 *   photo     { upload(file) → { file }, load(nombre) → Blob }  — campo «Foto del alumno»
 *             (la foto es privada: se sube y se ve con la sesión del usuario)
 */
function DynamicForm({ fields = [], values = {}, onChange, errors = {}, readOnly = false, photo = null, marks = {} }) {
  const set = (id) => (v) => onChange?.(id, v);
  return (
    <div className="dyn-form">
      {fields.map((f) => {
        if (f.type === 'section') {
          return (
            <div key={f.id} className="dyn-form__section">
              <h3>{f.label}</h3>
              {f.help && <p>{f.help}</p>}
            </div>
          );
        }
        const v = values[f.id];
        const label = (
          <>
            {f.label}
            {f.required && <span className="form-field__required">*</span>}
            {/* Precargado (re-inscripción): se quita en cuanto el representante lo edita. */}
            {marks[f.id] && (
              <span className="dyn-form__prefilled" title={marks[f.id] === 'record' ? 'Dato que el colegio tiene registrado' : 'Respuesta de la planilla anterior'}>
                {marks[f.id] === 'record' ? 'Registrado' : 'Planilla anterior'}
              </span>
            )}
          </>
        );
        if (f.type === 'photo') {
          return (
            <div key={f.id} className={`dyn-form__field ${errors[f.id] ? 'has-error' : ''}`}>
              <Field label={label} hint={readOnly ? undefined : f.help} error={errors[f.id]}>
                <PhotoInput value={v} onChange={readOnly ? null : set(f.id)} photo={photo} />
              </Field>
            </div>
          );
        }
        if (readOnly) {
          return (
            <div key={f.id} className="dyn-form__answer">
              <span className="dyn-form__answer-label">{f.label}</span>
              <span className={`dyn-form__answer-value ${v === undefined || v === '' || (Array.isArray(v) && !v.length) ? 'is-empty' : ''}`}>{formatAnswer(f, v)}</span>
            </div>
          );
        }
        return (
          <div key={f.id} className={`dyn-form__field ${errors[f.id] ? 'has-error' : ''}`}>
            {f.type === 'checkbox' ? (
              <label className="dyn-form__accept">
                <input type="checkbox" checked={v === true} onChange={(e) => set(f.id)(e.target.checked)} />
                <span>{label}</span>
              </label>
            ) : (
              <Field label={label} hint={f.help} error={errors[f.id]}>
                <Control field={f} value={v} onChange={set(f.id)} invalid={Boolean(errors[f.id])} />
              </Field>
            )}
            {f.type === 'checkbox' && (errors[f.id] ? <span className="field-error">{errors[f.id]}</span> : f.help && <span className="form-hint">{f.help}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function Control({ field: f, value, onChange, invalid }) {
  const common = { 'aria-invalid': invalid || undefined };
  switch (f.type) {
    case 'long_text':
      return <textarea className="input" rows={4} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={3000} {...common} />;
    case 'number':
      return <Input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} {...common} />;
    case 'date':
      return <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'email':
      return <Input type="email" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder || 'nombre@correo.com'} maxLength={150} {...common} />;
    case 'phone':
      return <Input type="tel" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder || '0414-0000000'} maxLength={25} {...common} />;
    case 'select':
      return (
        <Select value={value || ''} onChange={(e) => onChange(e.target.value)} {...common}>
          <option value="">Elige una opción…</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case 'radio':
      return (
        <div className="dyn-form__choices" role="radiogroup" aria-label={f.label}>
          {f.options.map((o) => (
            <label key={o} className={`dyn-form__choice ${value === o ? 'is-checked' : ''}`}>
              <input type="radio" name={f.id} checked={value === o} onChange={() => onChange(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    case 'checkboxes': {
      const list = Array.isArray(value) ? value : [];
      return (
        <div className="dyn-form__choices" role="group" aria-label={f.label}>
          {f.options.map((o) => (
            <label key={o} className={`dyn-form__choice ${list.includes(o) ? 'is-checked' : ''}`}>
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={200} {...common} />;
  }
}

/**
 * Foto del alumno: vista previa tipo carnet + subir / cambiar / quitar.
 * `value`: nombre del archivo guardado en el servidor (o vacío).
 */
function PhotoInput({ value, onChange, photo }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  // Foto ya guardada: se pide con la sesión (no es pública).
  useEffect(() => {
    let url = null;
    let alive = true;
    if (value && photo?.load && !preview?.local) {
      photo
        .load(value)
        .then((blob) => {
          if (!alive) return;
          url = URL.createObjectURL(blob);
          setPreview({ url, local: false });
        })
        .catch(() => alive && setPreview(null));
    }
    if (!value) setPreview(null);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pick = async (file) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return setError('Usa una foto JPG o PNG.');
    if (file.size > 4 * 1024 * 1024) return setError('La foto no puede pesar más de 4 MB.');
    setBusy(true);
    try {
      const { file: saved } = await photo.upload(file);
      setPreview({ url: URL.createObjectURL(file), local: true });
      onChange(saved);
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'No se pudo subir la foto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dyn-photo">
      <div className={`dyn-photo__frame ${preview ? 'has-photo' : ''}`}>
        {preview ? <img src={preview.url} alt="Foto del alumno" /> : <Icon name="user" size={30} />}
      </div>
      {onChange ? (
        <div className="dyn-photo__actions">
          <Button type="button" size="sm" variant="secondary" icon="upload" onClick={() => input.current?.click()} loading={busy} disabled={!photo?.upload}>
            {value ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {!photo?.upload && <span className="form-hint">En la vista previa no se suben fotos.</span>}
          {value && (
            <Button type="button" size="sm" variant="ghost" onClick={() => (onChange(''), setPreview(null))} disabled={busy}>
              Quitar
            </Button>
          )}
          <span className="form-hint">JPG o PNG · hasta 4 MB. Aparece en la planilla impresa.</span>
          {error && <span className="field-error">{error}</span>}
          <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
      ) : (
        !value && <span className="dyn-form__answer-value is-empty">Sin foto</span>
      )}
    </div>
  );
}

/** Respuesta en texto (revisión de la administración). */
export function formatAnswer(f, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return 'Sin respuesta';
  if (f.type === 'checkbox') return v ? 'Sí, aceptado' : 'No';
  if (f.type === 'checkboxes') return v.join(', ');
  if (f.type === 'date') {
    const [y, m, d] = String(v).split('-');
    return `${d}/${m}/${y}`;
  }
  return String(v);
}

export default DynamicForm;
