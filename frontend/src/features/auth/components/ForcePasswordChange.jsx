import { useState } from 'react';
import { createPortal } from 'react-dom';
import authApi from '../../../api/endpoints/auth.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import Icon from '../../../components/ui/Icon';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';

const MIN_LENGTH = 8; // mismo mínimo que el backend (auth.controller changePassword)

/**
 * Errores del formulario. `touched` decide cuáles se muestran mientras se
 * escribe (al enviar se muestran todos): así "no coinciden" aparece en cuanto
 * se escribe la confirmación, sin marcar en rojo campos que aún no se tocaron.
 */
function validate(form) {
  const err = {};
  if (!form.currentPassword) err.currentPassword = 'Ingresa la contraseña temporal que recibiste.';
  if (!form.newPassword) err.newPassword = 'Ingresa tu nueva contraseña.';
  else if (form.newPassword.length < MIN_LENGTH) err.newPassword = `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`;
  else if (form.newPassword === form.currentPassword) err.newPassword = 'La nueva contraseña debe ser distinta de la temporal.';
  if (!form.confirmPassword) err.confirmPassword = 'Confirma tu nueva contraseña.';
  else if (form.newPassword !== form.confirmPassword) err.confirmPassword = 'Las contraseñas no coinciden.';
  return err;
}

function ForcePasswordChange() {
  const { logout, refreshUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const errors = validate(form);
  const visible = (field) => (submitted || touched[field] ? errors[field] : undefined);
  const isValid = Object.keys(errors).length === 0;
  // Coinciden: confirmación visual cuando ambas están escritas y son iguales.
  const matches = Boolean(form.confirmPassword) && form.newPassword === form.confirmPassword && !errors.newPassword;

  const set = (field) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [field]: value }));
    setServerError('');
    // La confirmación se valida mientras se escribe; los demás campos, al salir de ellos.
    if (field === 'confirmPassword') setTouched((t) => ({ ...t, confirmPassword: true }));
  };
  const blur = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!isValid) return; // no se llama a la API si hay discrepancias
    setServerError('');
    setLoading(true);
    try {
      await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refreshUser();
    } catch (ex) {
      setServerError(getErrorMessage(ex) || 'No se pudo cambiar la contraseña. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="force-password" role="presentation">
      <div className="force-password__card" role="dialog" aria-modal="true" aria-labelledby="fpc-title">
        <div className="force-password__header">
          <span className="force-password__icon">
            <Icon name="lock" size={20} />
          </span>
          <h2 id="fpc-title">Cambio de contraseña requerido</h2>
        </div>

        <p className="force-password__intro">
          Tu acceso fue creado con una contraseña temporal. Por seguridad, debes establecer una nueva contraseña antes de continuar.
        </p>

        <Alert>{serverError}</Alert>

        <form onSubmit={handleSubmit} noValidate className="force-password__form">
          <Field label="Contraseña temporal" error={visible('currentPassword')} required>
            <Input
              id="fpc-current"
              type="password"
              icon="lock"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              onBlur={blur('currentPassword')}
              error={visible('currentPassword')}
              autoComplete="current-password"
              autoFocus
            />
          </Field>

          <Field label="Nueva contraseña" error={visible('newPassword')} hint={`Mínimo ${MIN_LENGTH} caracteres.`} required>
            <Input
              id="fpc-new"
              type="password"
              icon="lock"
              value={form.newPassword}
              onChange={set('newPassword')}
              onBlur={blur('newPassword')}
              error={visible('newPassword')}
              autoComplete="new-password"
            />
          </Field>

          <Field label="Confirmar contraseña" error={visible('confirmPassword')} required>
            <Input
              id="fpc-confirm"
              type="password"
              icon="lock"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              onBlur={blur('confirmPassword')}
              error={visible('confirmPassword')}
              autoComplete="new-password"
            />
            {matches && (
              <span className="field-success" role="status">
                <Icon name="checkCircle" size={14} />
                Las contraseñas coinciden.
              </span>
            )}
          </Field>

          <Button type="submit" className="btn--block" loading={loading} disabled={!isValid}>
            Establecer nueva contraseña
          </Button>
          {!isValid && (submitted || form.newPassword || form.confirmPassword) && (
            <p className="force-password__pending" aria-live="polite">
              {errors.confirmPassword === 'Las contraseñas no coinciden.'
                ? 'Corrige la confirmación: las contraseñas no coinciden.'
                : 'Completa los campos para continuar.'}
            </p>
          )}
        </form>

        <div className="force-password__footer">
          <Button type="button" variant="ghost" size="sm" onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ForcePasswordChange;
