import { Component } from 'react';
import Icon from './ui/Icon';

/**
 * Red de seguridad de la interfaz: si una pantalla falla al dibujarse, muestra
 * un aviso con opciones para reintentar o volver al inicio, en lugar de dejar
 * toda la aplicación en blanco. El menú lateral y la barra superior siguen
 * funcionando porque el límite envuelve solo el contenido de la página.
 *
 * `resetKey`: al cambiar (p. ej. la ruta), el error se limpia solo.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Error al mostrar la pantalla:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty-state error-boundary" role="alert">
        <div className="empty-state__icon">
          <Icon name="alertTriangle" size={24} />
        </div>
        <div className="empty-state__title">Esta pantalla tuvo un problema</div>
        <div className="text-sm">Tus datos están a salvo. Prueba recargar la pantalla; si el problema sigue, avisa al administrador.</div>
        <div className="error-boundary__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => window.location.reload()}>
            Recargar
          </button>
          <a href="/" className="btn btn--ghost btn--sm">
            Ir al inicio
          </a>
        </div>
        {import.meta.env.DEV && <pre className="error-boundary__detail">{String(this.state.error?.message || this.state.error)}</pre>}
      </div>
    );
  }
}

export default ErrorBoundary;
