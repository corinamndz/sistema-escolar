import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { placePopover } from './ColorPicker';

/**
 * Menú de acciones de una fila (botón «⋯»). Se abre en una capa sobre la página,
 * así no lo recorta el borde de una tarjeta o un panel con scroll, y se cierra con
 * Esc, con un clic fuera o al elegir una opción.
 *   items  [{ key, label, icon, onClick, danger }]  ·  label  nombre accesible del botón
 */
function RowMenu({ items, label = 'Más acciones' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  // Posición: debajo del botón, alineado a su derecha; arriba si no cabe.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const right = { ...anchor.toJSON(), left: anchor.right - menu.width };
    setPos(placePopover(right, menu, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e) => !menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target) && close();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    // El foco entra al menú para usarlo con el teclado.
    menuRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`row-menu__trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setPos(null);
          setOpen((v) => !v);
        }}
      >
        <Icon name="moreHorizontal" size={18} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="row-menu" role="menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
            {visible.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`row-menu__item ${it.danger ? 'is-danger' : ''}`}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.icon && <Icon name={it.icon} size={15} />}
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

export default RowMenu;
