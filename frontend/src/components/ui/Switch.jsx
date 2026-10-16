/**
 * Interruptor del sistema de diseño (encendido / apagado). Úsalo para
 * opciones que se activan o desactivan (envíos automáticos, publicar, avisos);
 * para elegir varias cosas de una lista, usa casillas normales.
 *
 *   <Switch checked={v} onChange={setV} label="Activar envíos" description="…" />
 *   <Switch checked={v} onChange={setV} ariaLabel="Campana" />   // sin texto visible (tablas)
 *
 * Apagado: gris neutro (--color-border-strong). Encendido: color principal del
 * colegio. Transición de 200 ms. Accesible: role="switch" + aria-checked.
 */
function Switch({ checked, onChange, label, description, disabled = false, ariaLabel, className = '' }) {
  const control = (
    <span className={`switch ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={Boolean(checked)}
        aria-label={label ? undefined : ariaLabel}
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="switch__track" aria-hidden="true" />
    </span>
  );
  if (!label) return control;
  return (
    <label className={`switch-row ${disabled ? 'is-disabled' : ''} ${className}`}>
      {control}
      <span>
        <span className="switch-row__label">{label}</span>
        {description && <span className="switch-row__desc">{description}</span>}
      </span>
    </label>
  );
}

export default Switch;
