import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

// Contador global para que modales anidados (ej. confirmación sobre un formulario)
// no liberen el scroll del body mientras quede alguno abierto.
let openModals = 0;

/**
 * Modal centrado con overlay difuminado (en móvil se muestra como hoja inferior).
 * `size`: 'sm' | 'lg'. `hideHeader` para diálogos que dibujan su propio encabezado.
 */
function Modal({ title, onClose, children, size, hideHeader }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (e) => e.key === 'Escape' && onCloseRef.current?.();
    document.addEventListener('keydown', onKeyDown);
    openModals += 1;
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openModals -= 1;
      if (openModals === 0) document.body.classList.remove('no-scroll');
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size ? `modal--${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {!hideHeader && (
          <div className="modal__header">
            <h3>{title}</h3>
            <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export default Modal;
