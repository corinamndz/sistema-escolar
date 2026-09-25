import { Link } from 'react-router-dom';
import Icon from '../../../components/ui/Icon';

function NotFoundPage() {
  return (
    <div className="not-found">
      <div className="not-found__code">404</div>
      <h2>Página no encontrada</h2>
      <p style={{ marginBottom: 20 }}>La ruta que buscas no existe o fue movida.</p>
      <Link to="/" className="btn btn--primary">
        <Icon name="arrowLeft" size={17} /> Volver al inicio
      </Link>
    </div>
  );
}

export default NotFoundPage;
