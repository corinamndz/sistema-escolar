import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useTenant } from '../../../context/TenantContext';
import { useMutation } from '../../../hooks/useMutation';
import publicApi from '../../../api/endpoints/public.api';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import {
  BRANDING_UPDATED_KEY,
  isValidSlug,
  normalizeSlug,
  rememberTenantSlug,
  resolveTenantSlug,
} from '../../../lib/tenantSlug';

const FEATURES = [
  { icon: 'graduation', label: 'Alumnos y representantes' },
  { icon: 'clipboard', label: 'Planes de evaluación' },
  { icon: 'card', label: 'Pagos y comprobantes' },
  { icon: 'shield', label: 'Roles y permisos' },
];

const LOOKUP_DELAY_MS = 350;

/** "Colegio San José de Calasanz" → "SJ" (para el monograma cuando no hay logo). */
const monogram = (name = '') =>
  name
    .replace(/^(colegio|escuela|instituto|unidad educativa|u\.?e\.?)\s+/i, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'SE';

/**
 * Busca la marca pública del colegio mientras se escribe el identificador y la
 * aplica al tema (colores, logo, título). Ignora respuestas viejas si el
 * usuario sigue escribiendo.
 * status: 'idle' | 'loading' | 'found' | 'not_found' | 'error'
 */
function useTenantBranding(slug) {
  const { applyBranding } = useTenant();
  const [state, setState] = useState({ status: 'idle', branding: null });
  const requestId = useRef(0);
  // Se incrementa para volver a pedir la marca sin que cambie el slug.
  const [refreshKey, setRefreshKey] = useState(0);

  // Recargar la marca si se guardó en Configuración (desde otra pestaña) o al volver
  // a esta pestaña: con `no-cache` + ETag, si nada cambió el servidor responde 304.
  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const onStorage = (e) => e.key === BRANDING_UPDATED_KEY && refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const clean = normalizeSlug(slug);
    const id = ++requestId.current;

    if (!isValidSlug(clean)) {
      setState({ status: clean ? 'not_found' : 'idle', branding: null });
      applyBranding(null);
      return undefined;
    }

    // En una recarga (misma marca) no se muestra "buscando": evita parpadeos.
    setState((s) => (s.branding && normalizeSlug(s.branding.slug) === clean ? s : { ...s, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const branding = await publicApi.getBranding(clean);
        if (id !== requestId.current) return;
        setState({ status: 'found', branding });
        applyBranding(branding);
      } catch (err) {
        if (id !== requestId.current) return;
        setState({ status: err?.response?.status === 404 ? 'not_found' : 'error', branding: null });
        applyBranding(null);
      }
    }, LOOKUP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [slug, applyBranding, refreshKey]);

  return state;
}

function SchoolMark({ branding, size = 'lg' }) {
  if (branding?.logoUrl) {
    return <img src={branding.logoUrl} alt={`Logo de ${branding.name}`} className={`school-mark school-mark--${size} school-mark--img`} />;
  }
  if (branding) {
    return <span className={`school-mark school-mark--${size}`}>{monogram(branding.name)}</span>;
  }
  return (
    <span className={`school-mark school-mark--${size}`}>
      <Icon name="school" size={size === 'lg' ? 28 : 20} />
    </span>
  );
}

function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { run, loading, error } = useMutation(login);

  // Colegio detectado por enlace, subdominio o último uso (ver lib/tenantSlug.js).
  const [initial] = useState(() => resolveTenantSlug());
  const [form, setForm] = useState({ tenantSlug: initial.slug, username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  // Por enlace o subdominio el colegio ya está decidido: se oculta el campo (con opción de cambiarlo).
  const [editingSchool, setEditingSchool] = useState(!['url', 'subdomain'].includes(initial.source));
  const { status, branding } = useTenantBranding(form.tenantSlug);

  // Si el colegio fijado por enlace no existe, se muestra el campo para corregirlo.
  useEffect(() => {
    if (!editingSchool && status === 'not_found') setEditingSchool(true);
  }, [editingSchool, status]);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run({ ...form, tenantSlug: normalizeSlug(form.tenantSlug) });
      rememberTenantSlug(form.tenantSlug);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch {
      // el error ya quedó en `error` vía useMutation
    }
  };

  const schoolName = branding?.name;
  const slugStatusIcon = {
    loading: <span className="btn__spinner login-slug__status" aria-label="Buscando colegio" />,
    found: <Icon name="checkCircle" size={17} className="login-slug__status text-success" />,
    not_found: <Icon name="alertCircle" size={17} className="login-slug__status text-danger" />,
  }[status];

  return (
    <div className={`login-page ${branding ? 'login-page--branded' : ''}`}>
      <aside className="login-hero">
        <div className="login-hero__brand">
          <SchoolMark branding={branding} size="sm" />
          {schoolName || 'Sistema Escolar'}
        </div>

        <div>
          {branding ? (
            <>
              <h1>Bienvenidos a {schoolName}</h1>
              <p>Portal de gestión escolar: calificaciones, pagos y comunicación con el colegio en un solo lugar.</p>
            </>
          ) : (
            <>
              <h1>La gestión de tu colegio, en un solo lugar.</h1>
              <p>Académico, administrativo y financiero conectados para que el equipo se enfoque en lo que importa: los alumnos.</p>
            </>
          )}
          <div className="login-features">
            {FEATURES.map((f) => (
              <div key={f.label} className="login-feature">
                <Icon name={f.icon} size={18} />
                {f.label}
              </div>
            ))}
          </div>
        </div>

        <div className="login-hero__foot">
          © {new Date().getFullYear()} {schoolName || 'Sistema Escolar'}
          {branding && ' · Plataforma Sistema Escolar'}
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <div className="login-card__brand">
            <SchoolMark branding={branding} />
            <div>
              <h2>{schoolName || 'Bienvenido de nuevo'}</h2>
              <p className="login-card__sub">
                {schoolName ? 'Inicia sesión para continuar.' : 'Ingresa con las credenciales de tu colegio.'}
              </p>
            </div>
          </div>

          <Alert>{error}</Alert>

          <form onSubmit={handleSubmit}>
            {editingSchool ? (
              <Field
                label="Colegio (identificador)"
                error={status === 'not_found' ? 'No encontramos un colegio con ese identificador.' : null}
                hint={status === 'found' ? `Colegio: ${schoolName}` : 'Te lo indica tu colegio. Ej.: demo'}
              >
                <div className="input-group login-slug">
                  <Icon name="building" size={17} className="input-group__icon" />
                  <input
                    className={`input ${status === 'not_found' ? 'input--error' : ''}`}
                    name="tenantSlug"
                    placeholder="ej. demo"
                    value={form.tenantSlug}
                    onChange={handleChange}
                    autoComplete="organization"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                  />
                  {slugStatusIcon}
                </div>
              </Field>
            ) : (
              <div className="login-school-chip">
                <Icon name="building" size={16} />
                <span>
                  Ingresando a <strong>{schoolName || form.tenantSlug}</strong>
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditingSchool(true)}>
                  Cambiar
                </button>
              </div>
            )}
            <Field label="Usuario o correo">
              <Input
                icon="user"
                name="username"
                placeholder="Tu usuario o correo electrónico"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </Field>
            <Field label="Contraseña">
              <div className="input-group">
                <Icon name="lock" size={17} className="input-group__icon" />
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                  required
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm btn--icon"
                  style={{ position: 'absolute', right: 5 }}
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  <Icon name="eye" size={16} />
                </button>
              </div>
            </Field>

            <div style={{ height: 24 }} />
            <Button type="submit" size="lg" className="btn--block" loading={loading} loadingText="Ingresando…">
              Ingresar <Icon name="arrowRight" size={17} />
            </Button>
          </form>

          {import.meta.env.DEV && (
            <div className="login-demo">
              <Icon name="sparkles" size={16} />
              <div>
                Datos de prueba: colegio <code>demo</code>, usuario <code>admin</code>, contraseña <code>Admin123!</code>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default LoginPage;
