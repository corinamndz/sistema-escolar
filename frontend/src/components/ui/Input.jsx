import Icon from './Icon';

/**
 * Input base. `icon` agrega un ícono descriptivo a la izquierda y `suffix`
 * un texto fijo a la derecha (ej. "%"). `error` pinta el borde en rojo.
 */
function Input({ error, icon, suffix, className = '', ...props }) {
  const input = (
    <input className={`input ${error ? 'input--error' : ''} ${className}`} aria-invalid={error ? true : undefined} {...props} />
  );

  if (!icon && !suffix) return input;

  return (
    <div className={`input-group ${suffix ? 'input-group--suffix' : ''}`}>
      {icon && <Icon name={icon} size={17} className="input-group__icon" />}
      {input}
      {suffix && <span className="input-group__suffix">{suffix}</span>}
    </div>
  );
}

export default Input;
