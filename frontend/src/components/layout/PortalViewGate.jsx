import { Link } from 'react-router-dom';
import Icon from '../ui/Icon';
import { usePortalViews } from '../../lib/portalViews';

/**
 * Página del portal que el colegio puede ocultar (Mis pagos, Cartelera): si la
 * sección está desactivada, muestra un aviso en vez de la página (el servidor
 * además responde 403 a sus datos).
 */
function PortalViewGate({ view, children }) {
  const isOn = usePortalViews();
  if (isOn(view)) return children;
  return (
    <div className="card empty-state" style={{ marginTop: 24 }}>
      <div className="empty-state__icon">
        <Icon name="eye" size={24} />
      </div>
      <div className="empty-state__title">Esta sección no está disponible</div>
      <div className="text-sm">El colegio la desactivó en el portal de las familias. Si la necesitas, comunícate con la administración.</div>
      <Link to="/" className="btn btn--secondary" style={{ marginTop: 14 }}>
        <Icon name="arrowLeft" size={16} /> Volver al inicio
      </Link>
    </div>
  );
}

export default PortalViewGate;
