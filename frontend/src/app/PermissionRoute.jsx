import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Bloquea una página completa si el usuario no tiene permiso de lectura sobre
 * el módulo. `blockTeacher`: además vedada a los docentes restringidos a su
 * carga. `guardianOnly`: solo cuentas de representante (sin `module`).
 */
function PermissionRoute({ module, blockTeacher = false, guardianOnly = false }) {
  const { can, user } = useAuth();

  const allowed =
    !(blockTeacher && user?.isRestrictedTeacher) && (guardianOnly ? Boolean(user?.guardianId) : can(module, 'read'));
  if (!allowed) {
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
