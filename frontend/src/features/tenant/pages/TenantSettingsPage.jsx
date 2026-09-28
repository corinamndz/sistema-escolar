import { useEffect, useState } from 'react';
import { useTenant } from '../../../context/TenantContext';
import { useAuth } from '../../../context/AuthContext';
import { useMutation } from '../../../hooks/useMutation';
import tenantApi from '../../../api/endpoints/tenant.api';
import RequirePermission from '../../../components/RequirePermission';
import PageHeader from '../../../components/ui/PageHeader';
import Card from '../../../components/ui/Card';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import ImageUpload from '../../../components/ui/ImageUpload';
import { useToast } from '../../../components/ui/Toast';
import { notifyBrandingChanged } from '../../../lib/tenantSlug';

const HEX = /^#[0-9A-Fa-f]{6}$/;

function pickForm(settings) {
  return {
    name: settings.name || '',
    primaryColor: settings.primaryColor || '#2563EB',
    secondaryColor: settings.secondaryColor || '#1E293B',
    contactPhone: settings.contactPhone || '',
    contactEmail: settings.contactEmail || '',
  };
}

/** URL temporal (blob:) para mostrar un File antes de subirlo. */
function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function ColorField({ label, name, value, onChange, error, disabled }) {
  const valid = HEX.test(value);
  return (
    <Field label={label} error={error || (!valid ? 'Usa un color hex, ej. #2563EB' : null)}>
      <div className="color-field">
        <label className="color-field__swatch" style={{ background: valid ? value : '#fff' }} title="Elegir color">
          <input
            type="color"
            name={name}
            value={valid ? value : '#000000'}
            onChange={onChange}
            aria-label={label}
            disabled={disabled}
          />
        </label>
        <Input name={name} value={value} onChange={onChange} error={!valid || error} maxLength={7} disabled={disabled} />
      </div>
    </Field>
  );
}

function TenantSettingsPage() {
  const { settings, refreshTenant } = useTenant();
  const { can } = useAuth();
  const toast = useToast();
  const { run, loading, error, fieldErrors } = useMutation(tenantApi.updateSettings);

  const [form, setForm] = useState(() => pickForm(settings));
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const logoPreview = useObjectUrl(logoFile);

  const canEdit = can('tenant_settings', 'update');

  useEffect(() => setForm(pickForm(settings)), [settings]);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleLogoChange = (file) => {
    setLogoFile(file);
    if (file) setRemoveLogo(false);
  };

  const colorsValid = HEX.test(form.primaryColor) && HEX.test(form.secondaryColor);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!colorsValid) return;

    const data = new FormData();
    data.append('name', form.name.trim());
    data.append('primaryColor', form.primaryColor);
    data.append('secondaryColor', form.secondaryColor);
    data.append('contactPhone', form.contactPhone.trim());
    data.append('contactEmail', form.contactEmail.trim());
    if (logoFile) data.append('logo', logoFile);
    else if (removeLogo) data.append('removeLogo', 'true');

    try {
      await run(data);
      await refreshTenant(); // esta pestaña: tema actualizado al instante
      notifyBrandingChanged(); // otras pestañas con el login abierto: recargan la marca
      setLogoFile(null);
      setRemoveLogo(false);
      toast.success('Configuración guardada', 'Los cambios ya se ven en todo el sistema.');
    } catch {
      // el error ya quedó reflejado en `error`/`fieldErrors`
    }
  };

  // Lo que se ve en la vista previa: archivo nuevo > logo guardado (si no se quitó).
  const previewLogo = logoPreview || (!removeLogo ? settings.logoUrl : null);
  const dirty =
    Boolean(logoFile) || removeLogo || JSON.stringify(form) !== JSON.stringify(pickForm(settings));

  return (
    <div>
      <PageHeader title="Configuración del colegio" subtitle="Nombre, logo, colores y datos de contacto" />

      <div className="grid settings-layout">
        <form onSubmit={handleSubmit} className="card">
          <Alert>{error}</Alert>

          <div className="form-grid">
            <Field label="Nombre del colegio" error={fieldErrors.name} full required>
              <Input icon="building" name="name" value={form.name} onChange={handleChange} disabled={!canEdit} required />
            </Field>

            <Field label="Logo" full>
              <ImageUpload
                currentUrl={settings.logoUrl}
                file={logoFile}
                onChange={handleLogoChange}
                removed={removeLogo}
                onRemove={() => setRemoveLogo(true)}
                error={fieldErrors.logo}
                disabled={!canEdit}
              />
              {removeLogo && (
                <span className="form-hint">
                  El logo se quitará al guardar.{' '}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ height: 'auto', padding: '0 4px' }}
                    onClick={() => setRemoveLogo(false)}
                  >
                    Deshacer
                  </button>
                </span>
              )}
            </Field>

            <Field label="Correo de contacto" error={fieldErrors.contactEmail}>
              <Input
                icon="inbox"
                name="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={handleChange}
                placeholder="secretaria@colegio.edu"
                disabled={!canEdit}
              />
            </Field>

            <Field label="Teléfono de contacto" error={fieldErrors.contactPhone}>
              <Input
                icon="user"
                name="contactPhone"
                value={form.contactPhone}
                onChange={handleChange}
                maxLength={30}
                disabled={!canEdit}
              />
            </Field>

            <ColorField
              label="Color primario"
              name="primaryColor"
              value={form.primaryColor}
              onChange={handleChange}
              error={fieldErrors.primaryColor}
              disabled={!canEdit}
            />
            <ColorField
              label="Color secundario (menú lateral)"
              name="secondaryColor"
              value={form.secondaryColor}
              onChange={handleChange}
              error={fieldErrors.secondaryColor}
              disabled={!canEdit}
            />
          </div>

          <RequirePermission module="tenant_settings" action="update">
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty || loading}
                onClick={() => {
                  setForm(pickForm(settings));
                  setLogoFile(null);
                  setRemoveLogo(false);
                }}
              >
                Descartar cambios
              </Button>
              <Button type="submit" loading={loading} disabled={!dirty || !colorsValid}>
                Guardar cambios
              </Button>
            </div>
          </RequirePermission>
        </form>

        <Card title="Vista previa" subtitle="Así se verá el panel con estos cambios">
          <div className="brand-preview">
            <div className="brand-preview__side" style={{ background: HEX.test(form.secondaryColor) ? form.secondaryColor : '#1E293B', color: '#f8fafc' }}>
              <div className="brand-preview__brand">
                {previewLogo ? (
                  <img src={previewLogo} alt="" className="brand-preview__logo" style={{ background: '#fff', padding: 2 }} />
                ) : (
                  <span className="brand-preview__logo" style={{ background: form.primaryColor }}>
                    <Icon name="school" size={16} />
                  </span>
                )}
                <span>{form.name || 'Nombre del colegio'}</span>
              </div>
              <div className="brand-preview__item" style={{ background: `${form.primaryColor}33` }}>
                Inicio
              </div>
              <div className="brand-preview__item" style={{ opacity: 0.6 }}>
                Alumnos
              </div>
              <div className="brand-preview__item" style={{ opacity: 0.6 }}>
                Pagos
              </div>
            </div>
            <div className="brand-preview__main">
              <div className="brand-preview__card">
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Tarjeta de ejemplo</div>
                <div style={{ height: 6, borderRadius: 99, background: 'var(--color-border)', marginBottom: 6 }} />
                <div style={{ height: 6, width: '60%', borderRadius: 99, background: 'var(--color-border)' }} />
              </div>
              <button
                type="button"
                className="btn btn--sm"
                style={{ background: form.primaryColor, color: '#fff', alignSelf: 'flex-start', cursor: 'default' }}
                tabIndex={-1}
              >
                Botón principal
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default TenantSettingsPage;
