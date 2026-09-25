import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Bloquea una página completa si el usuario no tiene permiso de lectura sobre ese módulo. */
function PermissionRoute({ module }) {
  const { can } = useAuth();

  if (!can(module, 'read')) {
    return (
      <div className="card">
        <h2>Acceso restringido</h2>
        <p>No tienes permiso para ver este módulo. Si crees que es un error, contacta a un administrador.</p>
      </div>
    );
  }

  return <Outlet />;
}

export default PermissionRoute;
