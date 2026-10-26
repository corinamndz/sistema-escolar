import { useState } from 'react';
import studentsApi from '../../../api/endpoints/students.api';
import { useMutation } from '../../../hooks/useMutation';
import Drawer from '../../../components/ui/Drawer';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { PasswordChooser, PortalAccessFields, buildPortalPayload, initialPortalState, validatePortal } from './PortalAccessFields';

/**
 * Acceso al portal desde la columna Acciones de Representantes (como
 * "Gestionar acceso al sistema" en Personal):
 *  - sin usuario: crea el acceso con el correo de su ficha (editable) y rol Representante;
 *  - con usuario: cambiar correo, activar/desactivar o restablecer la contraseña.
 * `onSaved({ portal, temporaryPassword })`: el padre muestra la contraseña temporal una sola vez.
 */
function GuardianPortalDrawer({ guardian, onClose, onSaved }) {
  const toast = useToast();
  const name = `${guardian.first_name} ${guardian.last_name}`;
  const [state, setState] = useState(() => ({ ...initialPortalState(guardian), enabled: true }));
  const { run, loading, error, fieldErrors } = useMutation((body) => studentsApi.updateGuardianPortal(guardian.id, body));
  const creating = !state.existing;
  const errors = validatePortal(state);
  const body = buildPortalPayload(state);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (Object.keys(errors).length || !body) return;
    try {
      const result = await run(body);
      toast.success(creating ? 'Acceso al portal creado' : 'Acceso actualizado', `${name} · ${result.portal.username}`);
      onSaved?.(result);
      onClose();
    } catch {
      // error visible en el panel
    }
  };

  return (
    <Drawer title={creating ? 'Crear acceso al portal de representantes' : `Acceso al portal · ${name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Alert>{error}</Alert>
        {creating ? (
          <div className="access-form">
            <p style={{ margin: 0 }}>
              <strong>{name}</strong> podrá iniciar sesión en el portal para ver los pagos, las calificaciones y el contenido de sus alumnos.
            </p>
            <Field
              label="Correo electrónico de acceso"
              error={errors.email || fieldErrors['portal.email']}
              hint={
                !guardian.email
                  ? 'Su ficha no tiene correo: indica uno para su usuario.'
                  : state.email.trim().toLowerCase() === guardian.email.toLowerCase()
                    ? 'Es el correo registrado en su ficha; será su usuario para iniciar sesión.'
                    : 'Será su usuario para iniciar sesión (la ficha conserva su correo).'
              }
              required
            >
              <Input
                icon="inbox"
                type="email"
                value={state.email}
                onChange={(e) => setState((s) => ({ ...s, email: e.target.value, emailTouched: true }))}
                placeholder="representante@correo.com"
              />
            </Field>
            <p className="form-hint new-access__note" style={{ margin: 0 }}>
              <Icon name="shield" size={14} /> Se le asigna el rol Representante.
            </p>
            <PasswordChooser state={state} setState={setState} errors={errors} serverError={fieldErrors['portal.password']} />
          </div>
        ) : (
          <PortalAccessFields state={state} setState={setState} fieldErrors={fieldErrors} />
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" icon={creating ? 'lock' : undefined} loading={loading} disabled={!body || Object.keys(errors).length > 0}>
            {creating ? 'Crear acceso' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default GuardianPortalDrawer;
