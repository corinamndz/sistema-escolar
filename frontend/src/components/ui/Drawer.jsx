import Modal from './Modal';
import Icon from './Icon';

/**
 * Panel lateral (derecha; en móvil, pantalla completa). Usa Modal por debajo:
 * cierre con Escape o clic fuera, bloqueo del scroll y apilado con otros modales.
 *
 *   <Drawer title="Historial" subtitle="Bs por 1 USD" icon="clock" onClose={…} footer={…}>…</Drawer>
 */
function Drawer({ title, subtitle, icon, onClose, footer, children }) {
  return (
    <Modal title={title} onClose={onClose} hideHeader className="drawer" overlayClassName="drawer-overlay">
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
        <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className="drawer__body">{children}</div>
      {footer && <footer className="drawer__footer">{footer}</footer>}
    </Modal>
  );
}

export default Drawer;
