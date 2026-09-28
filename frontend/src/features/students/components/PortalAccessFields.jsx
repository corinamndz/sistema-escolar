import { useState } from 'react';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Badge from '../../../components/ui/Badge';
import Icon from '../../../components/ui/Icon';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reglas de contraseña (mismas que valida el backend). */
export const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, label: 'Mínimo 8 caracteres' },
  { test: (p) => /[A-Za-z]/.test(p), label: 'Al menos una letra' },
  { test: (p) => /\d/.test(p), label: 'Al menos un número' },
];

/** Normaliza el acceso al portal venga de la fila del listado o del detalle. */
export function portalOf(guardian) {
  if (guardian.portal) return guardian.portal;
  if (guardian.portal_username) {
    return { username: guardian.portal_username, status: guardian.portal_status, last_login_at: guardian.portal_last_login_at };
  }
  return null;
}

export function PortalStatusBadge({ portal }) {
  if (!portal) return <Badge variant="neutral">Sin acceso</Badge>;
  return portal.status === 'active' ? <Badge variant="success">Acceso activo</Badge> : <Badge variant="warning">Acceso inactivo</Badge>;
}

export const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }) : null;

/** Estado inicial del formulario de acceso para un representante (nuevo o existente). */
export function initialPortalState(guardian) {
  const existing = portalOf(guardian);
  return {
    existing,
    enabled: !guardian.id, // al crear viene activado; al editar sin usuario, el admin decide
    email: existing?.username || guardian.email || '',
    emailTouched: Boolean(existing),
    passwordMode: 'auto', // 'auto' | 'custom'
    password: '',
    resetPassword: false,
    active: existing ? existing.status === 'active' : true,
  };
}

/** Errores de validación en vivo (los mismos que devolvería el backend). */
export function validatePortal(state) {
  const errors = {};
  const creating = !state.existing && state.enabled;
  if (creating || state.existing) {
    if (!state.email.trim()) errors.email = 'Indica el correo de acceso.';
    else if (!EMAIL_RE.test(state.email.trim())) errors.email = 'Correo inválido.';
  }
  const needsPassword = (creating || state.resetPassword) && state.passwordMode === 'custom';
  if (needsPassword) {
    const failed = PASSWORD_RULES.find((r) => !r.test(state.password));
    if (failed) errors.password = failed.label + '.';
  }
  return errors;
}

/** Cuerpo `portal` para la API, o undefined si no hay nada que cambiar. */
export function buildPortalPayload(state) {
  const password = state.passwordMode === 'custom' ? state.password : undefined;
  if (!state.existing) {
    return state.enabled ? { enabled: true, email: state.email.trim(), password } : undefined;
  }
  const changes = {};
  if (state.email.trim().toLowerCase() !== state.existing.username) changes.email = state.email.trim();
  if (state.resetPassword) Object.assign(changes, { resetPassword: true, password });
  const status = state.active ? 'active' : 'inactive';
  if (status !== state.existing.status) changes.status = status;
  return Object.keys(changes).length ? changes : undefined;
}

export function Switch({ checked, onChange, label, description }) {
  return (
    <label className="switch-row">
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch__track" aria-hidden="true" />
      </span>
      <span>
        <span className="switch-row__label">{label}</span>
        {description && <span className="switch-row__desc">{description}</span>}
      </span>
    </label>
  );
}

export function PasswordChooser({ state, setState, errors, serverError }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="portal-password">
      <div className="segmented" role="radiogroup" aria-label="Contraseña">
        {[
          ['auto', 'Generar contraseña temporal'],
          ['custom', 'Definir contraseña'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.passwordMode === mode}
            className={`segmented__item ${state.passwordMode === mode ? 'segmented__item--active' : ''}`}
            onClick={() => setState((s) => ({ ...s, passwordMode: mode }))}
          >
            {label}
          </button>
        ))}
      </div>

      {state.passwordMode === 'auto' ? (
        <p className="form-hint" style={{ margin: '8px 0 0' }}>
          Se generará una contraseña segura de 12 caracteres y se mostrará <strong>una sola vez</strong> al guardar.
        </p>
      ) : (
        <Field label="Contraseña" error={errors.password || serverError} required>
          <div className="input-group">
            <Icon name="lock" size={17} className="input-group__icon" />
            <input
              className={`input ${errors.password ? 'input--error' : ''}`}
              type={visible ? 'text' : 'password'}
              value={state.password}
              onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
              autoComplete="new-password"
              maxLength={72}
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              style={{ position: 'absolute', right: 5 }}
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <Icon name="eye" size={16} />
            </button>
          </div>
          <ul className="password-rules">
            {PASSWORD_RULES.map((r) => (
              <li key={r.label} className={r.test(state.password) ? 'is-ok' : undefined}>
                <Icon name={r.test(state.password) ? 'checkCircle' : 'alertCircle'} size={13} /> {r.label}
              </li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}

/**
 * Sección "Acceso al portal" del formulario del representante.
 * `state`/`setState` los maneja el formulario padre; `fieldErrors` son los del backend.
 */
export function PortalAccessFields({ state, setState, fieldErrors = {} }) {
  const errors = validatePortal(state);
  const setEmail = (email) => setState((s) => ({ ...s, email, emailTouched: true }));

  return (
    <fieldset className="portal-section">
      <legend className="portal-section__title">
        <Icon name="lock" size={17} /> Acceso al portal
        {state.existing && <PortalStatusBadge portal={{ ...state.existing, status: state.active ? 'active' : 'inactive' }} />}
      </legend>

      {!state.existing ? (
        <>
          <Switch
            checked={state.enabled}
            onChange={(enabled) => setState((s) => ({ ...s, enabled }))}
            label="Crear usuario de acceso al portal"
            description="Podrá iniciar sesión para ver los pagos y el avance de sus alumnos."
          />
          {state.enabled && (
            <div className="portal-section__body">
              <Field
                label="Correo electrónico de acceso"
                error={errors.email || fieldErrors['portal.email']}
                hint="Será su usuario para iniciar sesión."
                required
              >
                <Input icon="inbox" type="email" value={state.email} onChange={(e) => setEmail(e.target.value)} placeholder="representante@correo.com" />
              </Field>
              <PasswordChooser state={state} setState={setState} errors={errors} serverError={fieldErrors['portal.password']} />
            </div>
          )}
        </>
      ) : (
        <div className="portal-section__body">
          {state.existing.last_login_at !== undefined && (
            <p className="form-hint" style={{ margin: 0 }}>
              {state.existing.last_login_at ? `Último ingreso: ${formatDateTime(state.existing.last_login_at)}` : 'Todavía no ha ingresado al portal.'}
            </p>
          )}
          <Field label="Correo electrónico de acceso" error={errors.email || fieldErrors['portal.email']} required>
            <Input icon="inbox" type="email" value={state.email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Switch
            checked={state.active}
            onChange={(active) => setState((s) => ({ ...s, active }))}
            label="Acceso activo"
            description={state.active ? 'Puede iniciar sesión en el portal.' : 'No podrá iniciar sesión; sus datos se conservan.'}
          />
          <Switch
            checked={state.resetPassword}
            onChange={(resetPassword) => setState((s) => ({ ...s, resetPassword }))}
            label="Restablecer contraseña"
            description="La contraseña actual dejará de funcionar."
          />
          {state.resetPassword && (
            <PasswordChooser state={state} setState={setState} errors={errors} serverError={fieldErrors['portal.password']} />
          )}
        </div>
      )}
    </fieldset>
  );
}

/** Muestra las credenciales generadas una única vez, con botón de copiar. */
export function CredentialsModal({ name, username, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const text = `Usuario: ${username}\nContraseña temporal: ${password}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title="Credenciales de acceso al portal" onClose={onClose} size="sm">
      <p style={{ marginTop: -4 }}>
        Entrega estos datos a <strong>{name}</strong>. Por seguridad, la contraseña <strong>no se volverá a mostrar</strong>.
      </p>
      <dl className="credentials">
        <div>
          <dt>Usuario</dt>
          <dd>{username}</dd>
        </div>
        <div>
          <dt>Contraseña temporal</dt>
          <dd className="credentials__password">{password}</dd>
        </div>
      </dl>
      <div className="form-actions">
        <Button type="button" variant="secondary" icon={copied ? 'check' : 'clipboard'} onClick={copy}>
          {copied ? 'Copiado' : 'Copiar datos'}
        </Button>
        <Button type="button" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Modal>
  );
}
