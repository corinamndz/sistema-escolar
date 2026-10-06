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
import ImageUpload from '../../../components/ui/ImageUpload';
import { useToast } from '../../../components/ui/Toast';
import { notifyBrandingChanged } from '../../../lib/tenantSlug';
import { useThemePreview } from '../../../theme/ThemeProvider';
import AppearanceEditor, { ThemePreview } from '../components/AppearanceEditor';

const HEX = /^#[0-9A-Fa-f]{6}$/;

function pickForm(settings) {
  return {
    name: settings.name || '',
    primaryColor: settings.primaryColor || '#2563EB',
    secondaryColor: settings.secondaryColor || '#1E293B',
    menuGradient: settings.menuGradient || 'deep',
    accentSecondaryColor: settings.accentSecondaryColor || '', // '' = automático
    tableHeaderStyle: settings.tableHeaderStyle || 'subtle',
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

  const colorsValid = HEX.test(form.primaryColor) && HEX.test(form.secondaryColor) && (!form.accentSecondaryColor || HEX.test(form.accentSecondaryColor));

  // Vista previa EN VIVO en toda la plataforma mientras se editan los colores
  // (sin guardar). Al salir de la página o descartar, vuelve a lo guardado.
  const { setPreview } = useThemePreview();
  const themeKey = [form.primaryColor, form.secondaryColor, form.menuGradient, form.accentSecondaryColor, form.tableHeaderStyle].join('|');
  useEffect(() => {
    if (!colorsValid) return;
    setPreview({
      menuColor: form.secondaryColor,
      accentColor: form.primaryColor,
      menuGradient: form.menuGradient,
      accentSecondaryColor: form.accentSecondaryColor || null,
      tableHeaderStyle: form.tableHeaderStyle,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey, colorsValid]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!colorsValid) return;

    const data = new FormData();
    data.append('name', form.name.trim());
    data.append('primaryColor', form.primaryColor);
    data.append('secondaryColor', form.secondaryColor);
    data.append('menuGradient', form.menuGradient);
    data.append('tableHeaderStyle', form.tableHeaderStyle);
    data.append('accentSecondaryColor', form.accentSecondaryColor || 'auto');
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

            <div className="form-field--full appearance-section">
              <h3 className="appearance-section__title">Apariencia</h3>
              <p className="text-sm text-muted">
                Elige dos colores: el resto (degradado del menú, tonos al pasar el cursor, textos legibles) se calcula solo. Los cambios se ven en
                toda la plataforma mientras editas y se guardan al pulsar «Guardar cambios».
              </p>
              <AppearanceEditor form={form} setForm={setForm} onChange={handleChange} fieldErrors={fieldErrors} disabled={!canEdit} />
            </div>
          </div>

          <RequirePermission module="tenant_settings" action="update">
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={!dirty || loading}
                onClick={() => {
                  setForm(pickForm(settings));
                  setPreview(null);
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
          <ThemePreview form={form} logoUrl={previewLogo} />
        </Card>
      </div>
    </div>
  );
}

export default TenantSettingsPage;
