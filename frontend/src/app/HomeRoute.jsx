import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasDashboard, homePath } from '../components/layout/navigation';
import DashboardPage from '../features/dashboard/pages/DashboardPage';
import AccessDenied from './AccessDenied';

/** "/": el panel de inicio, o directo al primer módulo del usuario (ej. Finanzas → Pagos). */
function HomeRoute() {
  const { can, user } = useAuth();
  if (hasDashboard({ can, user })) return <DashboardPage />;
  const path = homePath({ can, user });
  if (path) return <Navigate to={path} replace />;
  return <AccessDenied message="Tu usuario todavía no tiene módulos asignados. Pídele a un administrador que te asigne un rol." />;
}

export default HomeRoute;
