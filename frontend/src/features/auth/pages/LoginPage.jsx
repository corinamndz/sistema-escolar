import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useTenant } from '../../../context/TenantContext';
import { useMutation } from '../../../hooks/useMutation';
import publicApi from '../../../api/endpoints/public.api';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import SchoolLogo, { isUsableLogoUrl } from '../../../components/ui/SchoolLogo';
import platformLogo from '../../../assets/modo-educa-logo.png';
import { ForgotPasswordForm, ResetPasswordForm } from '../components/PasswordRecovery';
import {
  BRANDING_UPDATED_KEY,
  isValidSlug,
  normalizeSlug,
  resolveTenantSlug,
} from '../../../lib/tenantSlug';
import { PATH_TENANT } from '../../../lib/tenantPath';

/**
 * Módulos del panel del login: cuadrícula simétrica de 2 columnas (3 filas), todas
 * las tarjetas con la misma estructura y altura; `isNew` agrega la etiqueta "Nuevo".
 */
const FEATURES = [
  { icon: 'graduation', label: 'Alumnos y representantes', desc: 'Expedientes, inscripciones y portal de las familias.' },
  { icon: 'clipboard', label: 'Planes de evaluación', desc: 'Planes, calificaciones y boletines con revisión.' },
  { icon: 'card', label: 'Pagos y comprobantes', desc: 'Mensualidades, pagos agrupados y recibos.' },
  { icon: 'bell', label: 'Avisos y recordatorios', desc: 'Notificaciones con confirmación de lectura.' },
  { icon: 'shield', label: 'Convivencia y disciplina', desc: 'Normas e historial visible para las familias.', isNew: true },
  { icon: 'clock', label: 'Gestión de horarios', desc: 'Bloques con arrastrar y soltar, sin cruces.', isNew: true },
];

const LOOKUP_DELAY_MS = 350;

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

/**
 * Sello institucional que corona el tarjetón del panel lateral: el logo del
 * colegio en cuanto se reconoce su identificador (sobre fondo claro, como un
 * escudo: los logos de los colegios suelen estar hechos para fondo blanco); sin
 * colegio o sin logo propio, el birrete de MoDo Educa sobre vidrio oscuro.
 */
function SchoolSeal({ branding }) {
  const custom = isUsableLogoUrl(branding?.logoUrl);
  return (
    <div className={`login-seal ${custom ? 'login-seal--school' : 'login-seal--platform'}`}>
      <SchoolLogo src={branding?.logoUrl} name={branding?.name} variant={custom ? 'full' : 'compact'} tone="dark" className="login-seal__logo" />
    </div>
  );
}

/** Producto y empresa creadora del software. */
const PLATFORM_NAME = 'MoDo Educa';
const COMPANY_NAME = 'MoDo Soluciones Tecnológicas';

/**
 * Logo oficial de MoDo Educa: preside SIEMPRE el formulario, para que quede
 * claro que se ingresa al sistema de gestión escolar de MoDo. Es un archivo de
 * assets (PNG horizontal con fondo transparente): Vite lo empaqueta con hash en
 * el nombre, así el navegador lo guarda en caché y carga al instante (la
 * pantalla de inicio ya lo trajo). Alto fijo + object-fit: contain → nunca se deforma.
 */
function PlatformLogo() {
  return (
    <div className="login-platform">
      <img src={platformLogo} alt={`${PLATFORM_NAME} · Sistema de gestión escolar`} width="1400" height="410" decoding="async" fetchpriority="high" />
    </div>
  );
}

/**
 * `mode`: 'login' (por defecto) · 'forgot' (/forgot-password: pedir el enlace) ·
 * 'reset' (/reset-password?token=…: crear la nueva contraseña). Los tres comparten
 * el panel del colegio; solo cambia el contenido de la tarjeta.
 */
function LoginPage({ mode = 'login' }) {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { run, loading, error } = useMutation(login);

  // Colegio de la ruta (/demo/login); si la URL no trae uno, subdominio o último
  // uso (lib/tenantSlug.js). Las sesiones son por colegio (api/tokenStore.js):
  // estar conectado en otro colegio no afecta a este login.
  const [initial] = useState(() => (PATH_TENANT ? { slug: PATH_TENANT, source: 'path' } : resolveTenantSlug()));
  const [form, setForm] = useState({ tenantSlug: initial.slug, username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const { status, branding } = useTenantBranding(form.tenantSlug);
  // Multi-tenant: la URL del colegio (/demo/login, enlace o subdominio) ya decide a
  // qué colegio se ingresa, así que no se pide. Solo si se entra sin colegio en la
  // URL (o el de la URL no existe) aparece el campo del identificador.
  const askSchool = !['path', 'url', 'subdomain'].includes(initial.source) || status === 'not_found';

  // Con sesión iniciada no hay login que mostrar; el enlace de recuperación sí se respeta.
  if (isAuthenticated && mode !== 'reset') {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await run({ ...form, tenantSlug: normalizeSlug(form.tenantSlug) });
      // Otro colegio: AuthContext ya guardó su sesión y está abriendo /<su-slug>/.
      if (result?.redirecting) return;
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

  const schoolField = askSchool && (
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
  );

  return (
    <div className={`login-page ${branding ? 'login-page--branded' : ''}`}>
      <aside className="login-hero">
        {/* Panel unificado (vidrio translúcido) coronado por el sello del colegio: identidad, bienvenida y módulos. */}
        <section className="login-showcase">
          <header className="login-showcase__head">
            <SchoolSeal branding={branding} />
            {branding ? (
              <>
                <span className="login-showcase__eyebrow">Portal de gestión escolar</span>
                <h1 className="login-showcase__school">{schoolName}</h1>
                <p>Bienvenidos: calificaciones, pagos y comunicación con el colegio en un solo lugar.</p>
              </>
            ) : (
              <>
                <span className="login-showcase__eyebrow">{PLATFORM_NAME}</span>
                <h1>La gestión de tu colegio, en un solo lugar.</h1>
                <p>Académico, administrativo y financiero conectados para que el equipo se enfoque en lo que importa: los alumnos.</p>
              </>
            )}
          </header>
          <ul className="login-features">
            {FEATURES.map((f) => (
              <li key={f.label} className={`login-feature${f.isNew ? ' login-feature--new' : ''}`}>
                <span className="login-feature__icon">
                  <Icon name={f.icon} size={18} />
                </span>
                <div className="login-feature__body">
                  <strong>
                    {f.label}
                    {f.isNew && <span className="login-feature__badge">Nuevo</span>}
                  </strong>
                  <span className="login-feature__desc">{f.desc}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Dos líneas: el colegio y la autoría del software (con nombres largos, nada se corta). */}
        <footer className="login-hero__foot">
          <span>
            © {new Date().getFullYear()}
            {schoolName ? ` ${schoolName}` : ` ${PLATFORM_NAME}`}
          </span>
          <span className="login-hero__credit">
            {PLATFORM_NAME}, un producto de {COMPANY_NAME}
          </span>
        </footer>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          {/* Solo la marca MoDo Educa: el colegio ya lo indica la URL (y el panel izquierdo). */}
          <header className="login-card__brand login-card__brand--stacked">
            <PlatformLogo />
            {mode === 'login' && <h2 className="sr-only">Iniciar sesión{schoolName ? ` en ${schoolName}` : ''}</h2>}
          </header>

          {mode === 'forgot' && <ForgotPasswordForm tenantSlug={normalizeSlug(form.tenantSlug)} schoolField={schoolField} />}
          {mode === 'reset' && <ResetPasswordForm tenantSlug={normalizeSlug(form.tenantSlug)} />}

          {mode === 'login' && (
            <>
              <Alert>{error}</Alert>

              <form className="login-form" onSubmit={handleSubmit}>
                {schoolField}
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
                  <Link to="/forgot-password" className="login-forgot">
                    ¿Olvidaste tu contraseña?
                  </Link>
                </Field>

                <Button type="submit" size="lg" className="btn--block login-form__submit" loading={loading} loadingText="Ingresando…">
                  Ingresar <Icon name="arrowRight" size={17} />
                </Button>
              </form>
            </>
          )}

        </div>
      </main>
    </div>
  );
}

export default LoginPage;
