import { useState } from 'react';
import { createPortal } from 'react-dom';
import authApi from '../../../api/endpoints/auth.api';
import { useAuth } from '../../../context/AuthContext';
import Icon from '../../../components/ui/Icon';

function FieldError({ message }) {
  if (!message) return null;
  return <p className="form-field__error">{message}</p>;
}

function ForcePasswordChange() {
  const { logout, refreshUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const err = {};
    if (!form.currentPassword) err.currentPassword = 'Ingresa la contraseña temporal que recibiste.';
    if (!form.newPassword) err.newPassword = 'Ingresa tu nueva contraseña.';
    else if (form.newPassword.length < 8) err.newPassword = 'La contraseña debe tener al menos 8 caracteres.';
    if (!form.confirmPassword) err.confirmPassword = 'Confirma tu nueva contraseña.';
    else if (form.newPassword && form.newPassword !== form.confirmPassword)
      err.confirmPassword = 'Las contraseñas no coinciden.';
    return err;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validate();
    if (Object.keys(err).length) { setErrors(err); return; }
    setErrors({});
    setServerError('');
    setLoading(true);
    try {
      await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refreshUser();
    } catch (ex) {
      setServerError(ex?.response?.data?.message || 'No se pudo cambiar la contraseña. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: 'var(--color-surface)', borderRadius: '12px',
          padding: '32px', width: '100%', maxWidth: '420px',
          border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fpc-title"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'var(--color-warning-soft)', color: 'var(--color-warning)',
            flexShrink: 0,
          }}>
            <Icon name="lock" size={20} />
          </span>
          <h2 id="fpc-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Cambio de contraseña requerido
          </h2>
        </div>

        <p style={{ margin: '0 0 24px', fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
          Tu acceso fue creado con una contraseña temporal. Por seguridad, debes establecer una nueva contraseña antes de continuar.
        </p>

        {serverError && (
          <div className="alert alert--error" style={{ marginBottom: '16px' }}>
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field" style={{ marginBottom: '16px' }}>
            <label className="form-field__label" htmlFor="fpc-current">Contraseña temporal</label>
            <input
              id="fpc-current"
              type="password"
              className={`form-field__input${errors.currentPassword ? ' form-field__input--error' : ''}`}
              value={form.currentPassword}
              onChange={set('currentPassword')}
              autoComplete="current-password"
              autoFocus
            />
            <FieldError message={errors.currentPassword} />
          </div>

          <div className="form-field" style={{ marginBottom: '16px' }}>
            <label className="form-field__label" htmlFor="fpc-new">Nueva contraseña</label>
            <input
              id="fpc-new"
              type="password"
              className={`form-field__input${errors.newPassword ? ' form-field__input--error' : ''}`}
              value={form.newPassword}
              onChange={set('newPassword')}
              autoComplete="new-password"
            />
            <FieldError message={errors.newPassword} />
          </div>

          <div className="form-field" style={{ marginBottom: '24px' }}>
            <label className="form-field__label" htmlFor="fpc-confirm">Confirmar contraseña</label>
            <input
              id="fpc-confirm"
              type="password"
              className={`form-field__input${errors.confirmPassword ? ' form-field__input--error' : ''}`}
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              autoComplete="new-password"
            />
            <FieldError message={errors.confirmPassword} />
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={loading}
          >
            {loading ? 'Guardando...' : 'Establecer nueva contraseña'}
          </button>
        </form>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={logout}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ForcePasswordChange;
