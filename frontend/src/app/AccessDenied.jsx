import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NAV_SECTIONS, homePath, navItemLabel } from '../components/layout/navigation';
import Icon from '../components/ui/Icon';

/** Acceso denegado, con un botón a la página de inicio del usuario (su panel o su módulo). */
function AccessDenied({ message = 'No tienes permiso para ver esta sección. Si crees que es un error, contacta a un administrador.' }) {
  const { can, user } = useAuth();
  const path = homePath({ can, user });
  const item = path && NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.path === path);

  return (
    <div className="not-found">
      <div className="not-found__code">
        <Icon name="lock" size={44} />
      </div>
      <h2>Acceso restringido</h2>
      <p style={{ marginBottom: 20 }}>{message}</p>
      {path && (
        <Link to={path} className="btn btn--primary">
          <Icon name="arrowLeft" size={17} /> Ir a {item ? navItemLabel(item, user) : 'inicio'}
        </Link>
      )}
    </div>
  );
}

export default AccessDenied;
