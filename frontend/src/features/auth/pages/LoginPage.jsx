import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useMutation } from '../../../hooks/useMutation';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';

const FEATURES = [
  { icon: 'graduation', label: 'Alumnos y representantes' },
  { icon: 'clipboard', label: 'Planes de evaluación' },
  { icon: 'card', label: 'Pagos y comprobantes' },
  { icon: 'shield', label: 'Roles y permisos' },
];

function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { run, loading, error } = useMutation(login);

  const [form, setForm] = useState({ tenantSlug: '', username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  if (isAuthenticated) {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await run(form);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch {
      // el error ya quedó en `error` vía useMutation
    }
  };

  return (
    <div className="login-page">
      <aside className="login-hero">
        <div className="login-hero__brand">
          <div className="sidebar__logo">
            <Icon name="school" size={20} />
          </div>
          Sistema Escolar
        </div>

        <div>
          <h1>La gestión de tu colegio, en un solo lugar.</h1>
          <p>Académico, administrativo y financiero conectados para que el equipo se enfoque en lo que importa: los alumnos.</p>
          <div className="login-features">
            {FEATURES.map((f) => (
              <div key={f.label} className="login-feature">
                <Icon name={f.icon} size={18} />
                {f.label}
              </div>
            ))}
          </div>
        </div>

        <div className="login-hero__foot">© {new Date().getFullYear()} Sistema Escolar · Plataforma multi-colegio</div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <h2>Bienvenido de nuevo</h2>
          <p className="login-card__sub">Ingresa con las credenciales de tu colegio.</p>

          <Alert>{error}</Alert>

          <form onSubmit={handleSubmit}>
            <Field label="Colegio (identificador)">
              <Input
                icon="building"
                name="tenantSlug"
                placeholder="ej. demo"
                value={form.tenantSlug}
                onChange={handleChange}
                autoComplete="organization"
                required
              />
            </Field>
            <Field label="Usuario">
              <Input
                icon="user"
                name="username"
                placeholder="Tu usuario"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
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

          <div className="login-demo">
            <Icon name="sparkles" size={16} />
            <div>
              Datos de prueba: colegio <code>demo</code>, usuario <code>admin</code>, contraseña <code>Admin123!</code>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default LoginPage;
