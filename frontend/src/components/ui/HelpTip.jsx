import { useId, useState } from 'react';
import Icon from './Icon';

/**
 * Ícono "?" con una explicación corta. Se abre con hover, con foco de teclado
 * y con tap (móvil); el texto queda enlazado por aria-describedby.
 *
 *   <HelpTip>Las aulas son opcionales…</HelpTip>
 */
function HelpTip({ children, label = 'Más información', placement = 'top' }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`help-tip help-tip--${placement} ${open ? 'is-open' : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="help-tip__trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <Icon name="helpCircle" size={15} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="help-tip__bubble">
          {children}
        </span>
      )}
    </span>
  );
}

export default HelpTip;
