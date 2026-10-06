import { Link } from 'react-router-dom';
import { useTenant } from '../../context/TenantContext';
import { useAuth } from '../../context/AuthContext';
import Icon from '../ui/Icon';

/** "+58 212 0000000" → "tel:+582120000000" (solo dígitos y el + inicial). */
const telHref = (phone) => `tel:${String(phone).replace(/(?!^\+)[^\d]/g, '')}`;

/**
 * Pie de página del inicio: una barra discreta con el copyright y el contacto
 * del colegio (teléfono y correo de Configuración). Va FUERA del contenido, al
 * final de la columna principal del layout (AppLayout), así que siempre queda
 * al fondo de la vista aunque la página tenga poco contenido.
 * Los datos vienen del estado global (TenantContext, cargado del backend).
 */
function SchoolFooter() {
  const { settings } = useTenant();
  const { can } = useAuth();
  const phone = settings.contactPhone;
  const email = settings.contactEmail;

  return (
    <footer className="school-footer">
      <span className="school-footer__copy">
        © {new Date().getFullYear()} {settings.name}
      </span>

      {phone || email ? (
        <span className="school-footer__contact" aria-label="Contacto del colegio">
          {phone && (
            <a href={telHref(phone)} className="school-footer__link">
              <Icon name="phone" size={13} /> {phone}
            </a>
          )}
          {phone && email && (
            <span className="school-footer__sep" aria-hidden="true">
              ·
            </span>
          )}
          {email && (
            <a href={`mailto:${email}`} className="school-footer__link">
              <Icon name="mail" size={13} /> {email}
            </a>
          )}
        </span>
      ) : (
        can('tenant_settings', 'update') && (
          <Link to="/tenant/settings" className="school-footer__link">
            <Icon name="settings" size={13} /> Agrega el teléfono y el correo en Configuración
          </Link>
        )
      )}
    </footer>
  );
}

export default SchoolFooter;
