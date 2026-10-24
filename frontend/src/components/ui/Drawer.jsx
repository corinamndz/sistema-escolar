import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';

const EXIT_MS = 200;
const DrawerContext = createContext({ close: () => {} });

/** Cierra el panel con su animación de salida (ej. después de guardar un formulario). */
export const useDrawer = () => useContext(DrawerContext);

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Panel lateral (derecha; en móvil, pantalla completa). Usa Modal por debajo:
 * Escape o clic en el fondo lo cierran, bloquea el scroll y se apila con otros modales.
 *
 * Cuándo usar cada uno (guía del proyecto):
 *   Drawer → formularios de edición rápida (moneda, perfil), vistas de detalle
 *            (ficha, historial) y configuración secundaria. Se ve la página detrás.
 *   Modal  → solo alertas críticas y confirmaciones de acciones destructivas o
 *            irreversibles (eliminar, anular): exigen atención total.
 *
 *   <Drawer title="Editar moneda" subtitle="Bolívar (VES)" icon="pencil" busy={saving}
 *           footer={<><Button variant="secondary" onClick={close}>Cancelar</Button>
 *                     <Button type="submit" form="currency-form">Guardar</Button></>}>
 *     <form id="currency-form" onSubmit={…}>…</form>
 *   </Drawer>
 *
 * - `size`: por defecto 520 px; 'lg' 800 px (tablas, editores amplios). 'sm' = por defecto.
 * - Un <form> con su barra `.form-actions` al final funciona tal cual: la barra
 *   queda fija al pie del panel (ver index.css), sin usar `footer`.
 * - `busy`: mientras se guarda no se puede cerrar (ni Escape, ni fondo, ni X).
 * - Los botones del pie envían el formulario del cuerpo con el atributo `form`.
 * - Cerrar con animación desde el código: `ref.current.close()` (ej. tras guardar),
 *   o `useDrawer().close()` desde un componente dentro del panel.
 */
const Drawer = forwardRef(function Drawer({ title, subtitle, icon, onClose, footer, size, busy = false, children }, ref) {
  // Mismos tamaños que Modal ('sm' | 'lg'), para migrar cambiando solo la etiqueta.
  const width = size === 'lg' ? 'lg' : 'md';
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => () => clearTimeout(timer.current), []);

  // Cierre desde el código (ej. tras guardar): no lo frena `busy`.
  const close = useCallback(() => {
    if (timer.current) return;
    if (reducedMotion()) return onClose();
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClosing(false);
      onClose();
    }, EXIT_MS);
  }, [onClose]);

  // Cierre del usuario (Escape, fondo, X): bloqueado mientras se guarda.
  const requestClose = useCallback(() => {
    if (!busyRef.current) close();
  }, [close]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  return (
    <DrawerContext.Provider value={{ close }}>
      <Modal
        title={title}
        onClose={requestClose}
        hideHeader
        className={`drawer drawer--${width} ${closing ? 'is-closing' : ''}`}
        overlayClassName={`drawer-overlay ${closing ? 'is-closing' : ''}`}
      >
        <header className="drawer__header">
          {icon && (
            <span className="drawer__icon">
              <Icon name={icon} size={18} />
            </span>
          )}
          <div className="drawer__titles">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="modal__close" onClick={requestClose} disabled={busy} aria-label="Cerrar">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__footer">{footer}</footer>}
      </Modal>
    </DrawerContext.Provider>
  );
});

export default Drawer;
