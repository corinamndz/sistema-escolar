import Icon from './Icon';

/**
 * Envuelve un input/select/textarea con label + mensaje de error, y aplica
 * la clase `form-field--full` cuando el campo debe ocupar las dos columnas
 * del form-grid (ver index.css).
 */
function Field({ label, error, full, children, hint, required }) {
  return (
    <div className={`form-field ${full ? 'form-field--full' : ''}`}>
      {label && (
        <label>
          {label}
          {required && <span className="form-field__required">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <span className="form-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          <Icon name="alertCircle" size={14} />
          {error}
        </span>
      )}
    </div>
  );
}

export default Field;
