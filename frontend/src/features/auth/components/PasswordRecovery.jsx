import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import authApi from '../../../api/endpoints/auth.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useMutation } from '../../../hooks/useMutation';
import Input from '../../../components/ui/Input';
import Field from '../../../components/ui/Field';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';

const MIN_LENGTH = 8;

/** Encabezado de cada paso: ícono en círculo, título y explicación breve. */
function StepHeader({ icon, tone = 'primary', title, children }) {
  return (
    <div className="recovery-head">
      <span className={`recovery-head__icon recovery-head__icon--${tone}`}>
        <Icon name={icon} size={22} />
      </span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function BackToLogin() {
  return (
    <Link to="/login" className="recovery-back">
      <Icon name="arrowLeft" size={15} /> Volver a iniciar sesión
    </Link>
  );
}

/**
 * Paso 1 · "¿Olvidaste tu contraseña?": pide el correo y envía el enlace.
 * La respuesta es la misma exista o no la cuenta (el backend no revela qué
 * correos están registrados). `schoolField`: campo del colegio, solo cuando la
 * URL no lo trae.
 */
export function ForgotPasswordForm({ tenantSlug, schoolField = null }) {
  const [email, setEmail] = useState('');
  const [sentMessage, setSentMessage] = useState(null);
  const { run, loading, error } = useMutation(authApi.forgotPassword);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { message } = await run({ tenantSlug, email: email.trim() });
      setSentMessage(message);
    } catch {
      // el error ya quedó en `error`
    }
  };

  if (sentMessage) {
    return (
      <div className="recovery">
        <StepHeader icon="mail" tone="success" title="Revisa tu correo">
          {sentMessage}
        </StepHeader>
        <p className="recovery-note">El enlace vence en 30 minutos. ¿No llegó? Espera un minuto y vuelve a intentarlo.</p>
        <Button variant="secondary" className="btn--block" onClick={() => setSentMessage(null)}>
          Usar otro correo
        </Button>
        <BackToLogin />
      </div>
    );
  }

  return (
    <div className="recovery">
      <StepHeader icon="lock" title="¿Olvidaste tu contraseña?">
        Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.
      </StepHeader>
      <Alert>{error}</Alert>
      <form className="login-form" onSubmit={handleSubmit}>
        {schoolField}
        <Field label="Correo electrónico">
          <Input
            icon="mail"
            type="email"
            name="email"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            autoFocus
            required
          />
        </Field>
        <Button type="submit" size="lg" className="btn--block login-form__submit" loading={loading} loadingText="Enviando…">
          Enviar enlace <Icon name="arrowRight" size={17} />
        </Button>
      </form>
      <BackToLogin />
    </div>
  );
}

/** Campo de contraseña con botón para mostrar/ocultar. */
function PasswordInput({ value, onChange, show, onToggle, ...props }) {
  return (
    <div className="input-group">
      <Icon name="lock" size={17} className="input-group__icon" />
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        style={{ paddingRight: 44 }}
        {...props}
      />
      <button
        type="button"
        className="btn btn--ghost btn--sm btn--icon"
        style={{ position: 'absolute', right: 5 }}
        onClick={onToggle}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <Icon name="eye" size={16} />
      </button>
    </div>
  );
}

/**
 * Paso 2 · enlace del correo (/<colegio>/reset-password?token=…). Primero
 * comprueba que el enlace siga vigente; luego pide la nueva contraseña dos veces.
 * Estados: verificando → inválido/vencido | formulario → listo.
 */
export function ResetPasswordForm({ tenantSlug }) {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [check, setCheck] = useState({ status: 'checking', error: null, username: null });
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const { run, loading, error } = useMutation(authApi.resetPassword);

  useEffect(() => {
    let cancelled = false;
    if (!token || !tenantSlug) {
      setCheck({ status: 'invalid', error: 'El enlace está incompleto. Ábrelo de nuevo desde el correo o solicita uno nuevo.' });
      return undefined;
    }
    authApi
      .verifyResetToken({ tenantSlug, token })
      .then((r) => !cancelled && setCheck({ status: 'valid', error: null, username: r.username }))
      .catch((err) => !cancelled && setCheck({ status: 'invalid', error: getErrorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [token, tenantSlug]);

  const tooShort = form.password.length > 0 && form.password.length < MIN_LENGTH;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;
  const canSubmit = form.password.length >= MIN_LENGTH && form.confirm === form.password;

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await run({ tenantSlug, token, newPassword: form.password });
      setDone(true);
    } catch {
      // vencido mientras escribía, contraseña inválida…: queda en `error`
    }
  };

  if (check.status === 'checking') {
    return (
      <div className="recovery">
        <Spinner label="Verificando el enlace…" />
      </div>
    );
  }

  if (check.status === 'invalid') {
    return (
      <div className="recovery">
        <StepHeader icon="alertTriangle" tone="danger" title="Enlace no válido">
          {check.error}
        </StepHeader>
        <Link to="/forgot-password" className="btn btn--primary btn--lg btn--block">
          Solicitar un enlace nuevo
        </Link>
        <BackToLogin />
      </div>
    );
  }

  if (done) {
    return (
      <div className="recovery">
        <StepHeader icon="checkCircle" tone="success" title="¡Contraseña actualizada!">
          Ya puedes iniciar sesión con tu nueva contraseña.
        </StepHeader>
        <Link to="/login" className="btn btn--primary btn--lg btn--block">
          Iniciar sesión <Icon name="arrowRight" size={17} />
        </Link>
      </div>
    );
  }

  return (
    <div className="recovery">
      <StepHeader icon="shield" title="Crea una nueva contraseña">
        {check.username ? (
          <>
            Para la cuenta <strong>{check.username}</strong>. Usa al menos {MIN_LENGTH} caracteres.
          </>
        ) : (
          `Usa al menos ${MIN_LENGTH} caracteres.`
        )}
      </StepHeader>
      <Alert>{error}</Alert>
      <form className="login-form" onSubmit={handleSubmit}>
        <Field label="Nueva contraseña" error={tooShort ? `Debe tener al menos ${MIN_LENGTH} caracteres.` : null}>
          <PasswordInput
            name="password"
            placeholder="••••••••"
            value={form.password}
            onChange={handleChange}
            show={show}
            onToggle={() => setShow((s) => !s)}
            autoComplete="new-password"
            autoFocus
            required
          />
        </Field>
        <Field label="Confirmar contraseña" error={mismatch ? 'Las contraseñas no coinciden.' : null}>
          <PasswordInput
            name="confirm"
            placeholder="••••••••"
            value={form.confirm}
            onChange={handleChange}
            show={show}
            onToggle={() => setShow((s) => !s)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Button type="submit" size="lg" className="btn--block login-form__submit" loading={loading} loadingText="Guardando…" disabled={!canSubmit}>
          Guardar contraseña
        </Button>
      </form>
      <BackToLogin />
    </div>
  );
}
