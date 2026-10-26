import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccessDenied from './AccessDenied';

/**
 * Bloquea una página completa si el usuario no tiene permiso de lectura sobre
 * el módulo. `blockTeacher`: además vedada a los docentes restringidos a su
 * carga. `guardianOnly`: solo cuentas de representante; `teacherOnly`: solo
 * usuarios con ficha docente (ambos sin `module`).
 */
function PermissionRoute({ module, blockTeacher = false, guardianOnly = false, teacherOnly = false, adminOnly = false }) {
  const { can, user } = useAuth();

  // adminOnly: solo el rol de sistema Administrador (el backend responde 403 al resto).
  const ownOnly = adminOnly ? Boolean(user?.isAdmin) : guardianOnly ? Boolean(user?.guardianId) : teacherOnly ? Boolean(user?.teachingStaffId) : null;
  const allowed = !(blockTeacher && user?.isRestrictedTeacher) && (ownOnly ?? can(module, 'read'));
  if (!allowed) return <AccessDenied />;

  return <Outlet />;
}

export default PermissionRoute;
