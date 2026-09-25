import Icon from './Icon';

const ICONS = { error: 'alertCircle', success: 'checkCircle', warning: 'alertTriangle', info: 'info' };

/** Mensaje inline dentro de un formulario o tarjeta. `variant`: error | success | warning | info. */
function Alert({ variant = 'error', children }) {
  if (!children) return null;
  return (
    <div className={`alert alert--${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon name={ICONS[variant] || 'info'} size={17} />
      <div>{children}</div>
    </div>
  );
}

export default Alert;
