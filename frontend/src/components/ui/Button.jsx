import Icon from './Icon';

/**
 * Botón base. `variant`: primary | secondary | danger | danger-solid | ghost.
 * `size`: 'sm' | 'lg'. `icon`: nombre de un ícono de <Icon /> que va antes del texto.
 * `loading` deshabilita el botón y muestra un spinner para evitar doble submit.
 */
function Button({ variant = 'primary', size, icon, loading, loadingText = 'Guardando…', children, className = '', ...props }) {
  const classes = ['btn', `btn--${variant}`, size ? `btn--${size}` : '', className].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={loading || props.disabled} aria-busy={loading || undefined} {...props}>
      {loading ? (
        <>
          <span className="btn__spinner" aria-hidden="true" />
          {loadingText}
        </>
      ) : (
        <>
          {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
          {children}
        </>
      )}
    </button>
  );
}

export default Button;
