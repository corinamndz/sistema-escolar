import { useMemo, useState } from 'react';
import staffApi from '../../../api/endpoints/staff.api';
import Select from '../../../components/ui/Select';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import { useMutation } from '../../../hooks/useMutation';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import Switch from '../../../components/ui/Switch';
import { PASSWORD_RULES, PasswordChooser, formatDateTime } from '../../students/components/PortalAccessFields';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// El rol del portal de padres no se asigna al personal (el backend también lo rechaza).
const isPortalRole = (role) => role.name.trim().toLowerCase() === 'representante';
// Jerarquía Director > Coordinador > Docente: el Coordinador exige su etapa.
const COORDINATOR_ROLE = 'Coordinador';
export const COORDINATION_LEVELS = { initial: 'Inicial', primary: 'Primaria', secondary: 'Secundaria' };

/** Estado del usuario de acceso de un empleado, para la tabla y el detalle. */
export function StaffAccessBadge({ status }) {
  if (!status) return <Badge variant="neutral">Sin usuario</Badge>;
  return status === 'active' ? <Badge variant="success">Acceso activo</Badge> : <Badge variant="warning">Acceso inactivo</Badge>;
}

/**
 * Crear o gestionar el usuario de acceso de un empleado:
 *  - sin usuario: correo, roles y contraseña (autogenerada o elegida);
 *  - con usuario: correo, roles, activo/inactivo y restablecer contraseña.
 * `onSaved({ access, temporaryPassword })`: el padre muestra la contraseña temporal una sola vez.
 */
function StaffAccessModal({ staff, onClose, onSaved }) {
  const { data, loading, error } = useFetch(() => staffApi.getAccess(staff.id), [staff.id]);
  const { data: roles, loading: loadingRoles, error: rolesError } = useFetch(() => staffApi.assignableRoles(), []);

  const title = `Acceso al sistema · ${staff.first_name} ${staff.last_name}`;
  return (
    <Drawer title={title} onClose={onClose}>
      <Alert>{error || rolesError}</Alert>
      {loading || loadingRoles || !data || !roles ? (
        <Spinner />
      ) : (
        <AccessForm staff={staff} access={data.access} roles={roles.filter((r) => !isPortalRole(r))} onClose={onClose} onSaved={onSaved} />
      )}
    </Drawer>
  );
}

function AccessForm({ staff, access, roles, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const isSelf = Boolean(access && access.id === user?.id);
  const defaultRoles = useMemo(() => {
    if (access) return access.roles.map((r) => r.id);
    // Docentes: rol "Docente" preseleccionado; coordinadores: rol "Coordinador" (con la etapa de su ficha).
    return presetRoleIds(roles, staff.staff_type);
  }, [access, roles, staff.staff_type]);

  const [state, setState] = useState({
    email: access?.username || staff.email || '',
    roleIds: defaultRoles,
    active: access ? access.status === 'active' : true,
    resetPassword: false,
    passwordMode: 'auto',
    password: '',
    coordinationLevel: staff.coordination_level || '',
  });
  const coordinatorRole = roles.find((r) => r.name === COORDINATOR_ROLE);
  const isCoordinator = Boolean(coordinatorRole && state.roleIds.includes(coordinatorRole.id));
  const { run, loading, error, fieldErrors } = useMutation((body) =>
    access ? staffApi.updateAccess(staff.id, body) : staffApi.createAccess(staff.id, body)
  );

  // ---- Validación en vivo (mismas reglas que el backend) ----
  const errors = {};
  if (!EMAIL_RE.test(state.email.trim())) errors.email = 'Correo inválido.';
  if (state.roleIds.length === 0) errors.roleIds = 'Selecciona al menos un rol.';
  if (isCoordinator && !state.coordinationLevel) errors.coordinationLevel = 'Indica el nivel de coordinación.';
  const needsPassword = (!access || state.resetPassword) && state.passwordMode === 'custom';
  if (needsPassword) {
    const failed = PASSWORD_RULES.find((r) => !r.test(state.password));
    if (failed) errors.password = `${failed.label}.`;
  }
  const staffInactive = staff.status !== 'active';

  const toggleRole = (id) =>
    setState((s) => ({ ...s, roleIds: s.roleIds.includes(id) ? s.roleIds.filter((r) => r !== id) : [...s.roleIds, id] }));

  // Solo se envía lo que cambió.
  const buildBody = () => {
    const password = state.passwordMode === 'custom' ? state.password : undefined;
    const coordinationLevel = isCoordinator ? state.coordinationLevel || null : null;
    if (!access) return { email: state.email.trim(), roleIds: state.roleIds, password, ...(isCoordinator ? { coordinationLevel } : {}) };
    const body = {};
    if (state.email.trim().toLowerCase() !== access.username) body.email = state.email.trim();
    const current = access.roles.map((r) => r.id);
    if (state.roleIds.length !== current.length || state.roleIds.some((id) => !current.includes(id))) body.roleIds = state.roleIds;
    if (isCoordinator && coordinationLevel !== (staff.coordination_level || null)) body.coordinationLevel = coordinationLevel;
    const status = state.active ? 'active' : 'inactive';
    if (status !== access.status) body.status = status;
    if (state.resetPassword) Object.assign(body, { resetPassword: true, password });
    return body;
  };
  const body = buildBody();
  const dirty = !access || Object.keys(body).length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (Object.keys(errors).length) return;
    try {
      const result = await run(body);
      toast.success(access ? 'Acceso actualizado' : 'Usuario creado', `${staff.first_name} ${staff.last_name} · ${result.access.username}`);
      onSaved?.(result);
      onClose();
    } catch {
      // error visible en el modal
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {access ? (
        <div className="portal-summary">
          <Icon name="lock" size={16} />
          <span>
            Usuario: <strong>{access.username}</strong>
          </span>
          <span className="text-muted">
            {access.last_login_at ? `Último ingreso: ${formatDateTime(access.last_login_at)}` : 'Aún no ha ingresado'}
          </span>
        </div>
      ) : (
        <p style={{ marginTop: -4 }}>
          Crea el usuario con el que <strong>{staff.first_name}</strong> iniciará sesión. Sus permisos dependen de los roles que le asignes.
        </p>
      )}

      {staffInactive && (
        <Alert variant="warning">
          El empleado está inactivo: {access ? 'su acceso no se puede reactivar' : 'no se le puede crear acceso'} hasta que se active en su ficha.
        </Alert>
      )}
      {isSelf && <Alert variant="info">Es tu propia cuenta: puedes cambiar tu correo o contraseña, pero no tus roles ni desactivarte.</Alert>}
      <Alert>{error}</Alert>

      <div className="access-form">
        <Field label="Correo electrónico de acceso" error={(state.email && errors.email) || fieldErrors.email} hint="Será su usuario para iniciar sesión." required>
          <Input icon="inbox" type="email" value={state.email} onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))} placeholder="nombre@colegio.edu" />
        </Field>

        <Field label="Roles" error={errors.roleIds || fieldErrors.roleIds} hint="Definen a qué módulos puede entrar (se configuran en Roles y permisos)." required>
          <div className="role-options" role="group" aria-label="Roles">
            {roles.map((role) => (
              <label key={role.id} className={`role-option ${state.roleIds.includes(role.id) ? 'is-selected' : ''} ${isSelf ? 'is-disabled' : ''}`}>
                <input type="checkbox" checked={state.roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} disabled={isSelf} />
                <Icon name="shield" size={15} />
                {role.name}
              </label>
            ))}
          </div>
        </Field>

        {isCoordinator && (
          <Field
            label="Nivel de coordinación"
            error={errors.coordinationLevel || fieldErrors.coordinationLevel}
            hint="Delimita sus permisos y vistas: solo gestionará a los docentes de ese nivel."
            required
          >
            <Select value={state.coordinationLevel} onChange={(e) => setState((s) => ({ ...s, coordinationLevel: e.target.value }))} disabled={isSelf}>
              <option value="">Selecciona el nivel…</option>
              {Object.entries(COORDINATION_LEVELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {access && (
          <Switch
            checked={state.active}
            onChange={(active) => setState((s) => ({ ...s, active }))}
            label="Acceso activo"
            description={state.active ? 'Puede iniciar sesión.' : 'No podrá iniciar sesión; su historial se conserva.'}
          />
        )}

        {access ? (
          <>
            <Switch
              checked={state.resetPassword}
              onChange={(resetPassword) => setState((s) => ({ ...s, resetPassword }))}
              label="Restablecer contraseña"
              description="La contraseña actual dejará de funcionar."
            />
            {state.resetPassword && <PasswordChooser state={state} setState={setState} errors={errors} serverError={fieldErrors.password} />}
          </>
        ) : (
          <PasswordChooser state={state} setState={setState} errors={errors} serverError={fieldErrors.password} />
        )}
      </div>

      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="submit"
          icon={access ? undefined : 'lock'}
          loading={loading}
          disabled={!dirty || Object.keys(errors).length > 0 || (staffInactive && (!access || (state.active && access.status !== 'active')))}
        >
          {access ? 'Guardar cambios' : 'Crear usuario'}
        </Button>
      </div>
    </form>
  );
}

// ---- Usuario de acceso dentro del alta de personal ("Nuevo personal") ----

export const NEW_ACCESS_INITIAL = { enabled: false, email: '', roleIds: null, coordinationLevel: '', passwordMode: 'auto', password: '' };

/** Rol sugerido por el tipo de personal: Docente → "Docente"; Coordinador → "Coordinador". */
function presetRoleIds(roles, staffType) {
  const byName = (name) => roles.find((r) => r.name.trim().toLowerCase() === name);
  const preset = (staffType === 'teaching' && byName('docente')) || (staffType === 'coordinator' && byName('coordinador'));
  return preset ? [preset.id] : [];
}

/**
 * Lo que se enviará como `access` en POST /staff, con su validación en vivo
 * (mismas reglas que el backend). `roleIds: null` = aún sin tocar: sigue al tipo de personal.
 * La etapa de un coordinador sale de su ficha si es de tipo Coordinador; si no, de esta sección.
 */
export function resolveNewAccess(access, roles, staff) {
  const roleIds = access.roleIds ?? presetRoleIds(roles, staff.staffType);
  const email = access.email.trim() || staff.email.trim();
  const coordinatorRole = roles.find((r) => r.name === COORDINATOR_ROLE);
  const isCoordinatorRole = Boolean(coordinatorRole && roleIds.includes(coordinatorRole.id));
  const levelFromProfile = staff.staffType === 'coordinator';
  const coordinationLevel = isCoordinatorRole ? (levelFromProfile ? staff.coordinationLevel : access.coordinationLevel) : '';

  const errors = {};
  if (!EMAIL_RE.test(email)) errors.email = email ? 'Correo inválido.' : 'Indica el correo de acceso.';
  if (roleIds.length === 0) errors.roleIds = 'Selecciona al menos un rol.';
  if (isCoordinatorRole && !levelFromProfile && !coordinationLevel) errors.coordinationLevel = 'Indica el nivel de coordinación.';
  if (access.passwordMode === 'custom') {
    const failed = PASSWORD_RULES.find((r) => !r.test(access.password));
    if (failed) errors.password = `${failed.label}.`;
  }
  const body = {
    email,
    roleIds,
    ...(access.passwordMode === 'custom' ? { password: access.password } : {}),
    ...(isCoordinatorRole && coordinationLevel ? { coordinationLevel } : {}),
  };
  return { body, errors, roleIds, isCoordinatorRole, levelFromProfile };
}

/**
 * Sección colapsable "Crear usuario de acceso al sistema" del formulario de
 * alta: correo (por defecto, el de la ficha), roles, nivel de coordinación si
 * se elige Coordinador y contraseña. Se guarda junto con la ficha, en una sola
 * transacción (si falla el usuario, tampoco se registra al empleado).
 */
export function NewAccessSection({ access, setAccess, roles, rolesLoading, rolesError, resolved, staffEmail, showErrors, fieldErrors }) {
  const set = (patch) => setAccess((a) => ({ ...a, ...patch }));
  const err = (key) => (showErrors ? resolved.errors[key] : null) || fieldErrors[`access.${key}`];
  const toggleRole = (id) => {
    const current = resolved.roleIds;
    set({ roleIds: current.includes(id) ? current.filter((r) => r !== id) : [...current, id] });
  };

  return (
    <section className={`new-access ${access.enabled ? 'is-open' : ''}`}>
      <Switch
        checked={access.enabled}
        onChange={(enabled) => set({ enabled })}
        label="Crear usuario de acceso al sistema"
        description={access.enabled ? 'Se crea junto con la ficha: si algo falla, no se guarda ninguno de los dos.' : 'Podrás crearlo después desde «Gestionar acceso al sistema».'}
      />
      {access.enabled && (
        <div className="access-form new-access__body">
          <Alert>{rolesError}</Alert>
          {rolesLoading ? (
            <Spinner />
          ) : (
            <>
              <Field
                label="Correo electrónico de acceso"
                error={err('email')}
                hint={access.email.trim() ? 'Será su usuario para iniciar sesión.' : 'Si lo dejas vacío se usa el correo de la ficha.'}
                required
              >
                <Input icon="inbox" type="email" value={access.email} onChange={(e) => set({ email: e.target.value })} placeholder={staffEmail || 'nombre@colegio.edu'} />
              </Field>

              <Field label="Rol de usuario" error={err('roleIds')} hint="Define a qué módulos puede entrar (se configuran en Roles y permisos)." required>
                <div className="role-options" role="group" aria-label="Rol de usuario">
                  {roles.map((role) => (
                    <label key={role.id} className={`role-option ${resolved.roleIds.includes(role.id) ? 'is-selected' : ''}`}>
                      <input type="checkbox" checked={resolved.roleIds.includes(role.id)} onChange={() => toggleRole(role.id)} />
                      <Icon name="shield" size={15} />
                      {role.name}
                    </label>
                  ))}
                </div>
              </Field>

              {resolved.isCoordinatorRole &&
                (resolved.levelFromProfile ? (
                  <p className="form-hint new-access__note">
                    <Icon name="info" size={14} /> Coordinará el nivel elegido arriba en «Nivel de coordinación».
                  </p>
                ) : (
                  <Field label="Nivel" error={err('coordinationLevel')} hint="Delimita sus permisos y vistas: solo gestionará a los docentes de ese nivel." required>
                    <Select value={access.coordinationLevel} onChange={(e) => set({ coordinationLevel: e.target.value })}>
                      <option value="">Selecciona el nivel…</option>
                      {Object.entries(COORDINATION_LEVELS).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}

              <PasswordChooser state={access} setState={setAccess} errors={showErrors ? resolved.errors : {}} serverError={fieldErrors['access.password']} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default StaffAccessModal;
