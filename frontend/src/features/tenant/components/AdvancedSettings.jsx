import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import Card from '../../../components/ui/Card';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { tenantUrl } from '../../../lib/tenantPath';

/** Ajustes del sistema que viven en su propio módulo: acceso directo según permisos. */
const SHORTCUTS = [
  {
    to: '/roles',
    icon: 'shield',
    title: 'Roles y permisos',
    text: 'Qué puede ver y hacer cada rol (administración, docentes, representantes).',
    can: (can) => can('roles', 'read'),
  },
  {
    to: '/payments/currencies',
    icon: 'trendingUp',
    title: 'Monedas y tasas',
    text: 'Monedas aceptadas, tasa del día y conversión de las mensualidades.',
    can: (can) => can('payments', 'read'),
  },
  {
    to: '/academics/promotion',
    icon: 'graduation',
    title: 'Normativa de evaluación y cierre',
    text: 'Nota mínima, materias reprobadas permitidas y cierre del año escolar.',
    can: (can) => can('promotion', 'read'),
  },
  {
    to: '/academics',
    icon: 'school',
    title: 'Estructura académica',
    text: 'Grados, secciones, plan de estudios y carga docente.',
    can: (can) => can('academics', 'read'),
  },
];

/**
 * Pestaña "Otros / Avanzado" de Configuración: datos de acceso del colegio
 * (identificador y enlace directo al inicio de sesión) y atajos a los ajustes
 * del sistema que se administran en sus propios módulos.
 */
function AdvancedSettings({ settings }) {
  const { can } = useAuth();
  const toast = useToast();
  const [copied, setCopied] = useState(null);
  const loginUrl = settings.slug ? `${window.location.origin}${tenantUrl(settings.slug, '/login')}` : null;

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error('No se pudo copiar', 'Selecciona el texto y cópialo a mano.');
    }
  };

  const shortcuts = SHORTCUTS.filter((s) => s.can(can));

  return (
    <div className="advanced-settings">
      <Card title="Acceso a la plataforma" subtitle="Compártelo con docentes y representantes para que entren directo a su colegio.">
        <dl className="advanced-settings__access">
          <div>
            <dt>Identificador del colegio</dt>
            <dd>
              <code>{settings.slug || '—'}</code>
              {settings.slug && (
                <button type="button" className="link-button" onClick={() => copy(settings.slug, 'slug')}>
                  <Icon name={copied === 'slug' ? 'check' : 'paperclip'} size={13} /> {copied === 'slug' ? 'Copiado' : 'Copiar'}
                </button>
              )}
            </dd>
          </div>
          {loginUrl && (
            <div>
              <dt>Enlace de inicio de sesión</dt>
              <dd>
                <code className="advanced-settings__url">{loginUrl}</code>
                <button type="button" className="link-button" onClick={() => copy(loginUrl, 'url')}>
                  <Icon name={copied === 'url' ? 'check' : 'paperclip'} size={13} /> {copied === 'url' ? 'Copiado' : 'Copiar'}
                </button>
              </dd>
            </div>
          )}
          {settings.status && (
            <div>
              <dt>Estado de la cuenta</dt>
              <dd>{settings.status === 'active' ? 'Activa' : settings.status === 'trial' ? 'Periodo de prueba' : 'Suspendida'}</dd>
            </div>
          )}
        </dl>
      </Card>

      {shortcuts.length > 0 && (
        <Card title="Más ajustes del sistema" subtitle="Se administran en su propio módulo.">
          <div className="advanced-settings__links">
            {shortcuts.map((s) => (
              <Link key={s.to} to={s.to} className="advanced-link">
                <span className="advanced-link__icon">
                  <Icon name={s.icon} size={18} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.text}</small>
                </span>
                <Icon name="chevronRight" size={16} className="advanced-link__chevron" />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default AdvancedSettings;
