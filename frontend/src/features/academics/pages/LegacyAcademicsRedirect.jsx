import { Navigate, useLocation } from 'react-router-dom';
import { INITIAL_SETUP_PATH, ACADEMIC_SECTIONS_PATH } from '../setup/guides';

/**
 * /academics (antes "Grados y secciones", con pestañas) se dividió en dos
 * páginas. Los enlaces y marcadores viejos llegan a la que corresponde:
 *   ?vista=pasos&paso=period|structure → Configuración inicial (ese paso)
 *   ?paso=sections                     → Secciones y docentes, listado de secciones
 *   resto (?grado=… incluido)          → Secciones y docentes, panel por grado
 */
function LegacyAcademicsRedirect() {
  const params = new URLSearchParams(useLocation().search);
  const paso = params.get('paso');
  if (paso === 'period' || paso === 'structure') return <Navigate to={`${INITIAL_SETUP_PATH}?paso=${paso}`} replace />;
  if (paso === 'sections') return <Navigate to={`${ACADEMIC_SECTIONS_PATH}?vista=secciones`} replace />;
  if (params.get('vista') === 'pasos') return <Navigate to={INITIAL_SETUP_PATH} replace />;
  const grado = params.get('grado');
  return <Navigate to={grado ? `${ACADEMIC_SECTIONS_PATH}?grado=${encodeURIComponent(grado)}` : ACADEMIC_SECTIONS_PATH} replace />;
}

export default LegacyAcademicsRedirect;
