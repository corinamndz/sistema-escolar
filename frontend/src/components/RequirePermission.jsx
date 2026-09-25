import { useAuth } from '../context/AuthContext';

/**
 * Oculta a sus hijos si el usuario no tiene el permiso indicado. Se usa para
 * esconder botones de "Crear"/"Eliminar" etc. — el backend igual valida todo
 * de nuevo, esto es solo para no mostrar acciones que van a fallar con 403.
 */
function RequirePermission({ module, action, children, fallback = null }) {
  const { can } = useAuth();
  return can(module, action) ? children : fallback;
}

export default RequirePermission;
