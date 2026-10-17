import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ForcePasswordChange from '../features/auth/components/ForcePasswordChange';

/** Bloquea el acceso a rutas hijas si no hay sesión activa. */
function ProtectedRoute() {
  const { isAuthenticated, mustChangePassword, initializing } = useAuth();
  const location = useLocation();

  if (initializing) return null; // evita un parpadeo al login mientras se valida el token guardado

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <>
      <Outlet />
      {mustChangePassword && <ForcePasswordChange />}
    </>
  );
}

export default ProtectedRoute;
