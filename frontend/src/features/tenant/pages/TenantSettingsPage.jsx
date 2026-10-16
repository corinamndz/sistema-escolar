import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { DEFAULT_SCHOOL_LOGO } from '../../../components/ui/SchoolLogo';
import { useToast } from '../../../components/ui/Toast';
import { notifyBrandingChanged } from '../../../lib/tenantSlug';
import { useThemePreview } from '../../../theme/ThemeProvider';
import AppearanceEditor, { ThemePreview } from '../components/AppearanceEditor';
import GradingScalesCard from '../components/GradingScalesCard';
import AdvancedSettings from '../components/AdvancedSettings';
import PaymentAccountsSettings from '../components/PaymentAccountsSettings';
import BcvRateCard from '../../payments/components/BcvRateCard';
import SchoolPeriodsTab from '../../academics/components/SchoolPeriodsTab';

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Pestañas de Configuración. `can`: quién la ve (por defecto, quien entra a
 * Configuración). General y Apariencia comparten un mismo formulario y se
 * guardan juntas; Años escolares y Escalas se guardan al instante.
 */
const TABS = [
  { key: 'general', label: 'General', long: '/ Institución', icon: 'building', hint: 'Nombre, logo y datos de contacto del colegio.' },
  { key: 'apariencia', label: 'Apariencia', long: 'y colores', icon: 'sparkles', hint: 'Color del menú lateral y color de acento de la plataforma.' },
  {
    key: 'anios',
    label: 'Años escolares',
    icon: 'calendar',
    hint: 'Crea, consulta o elimina los periodos académicos del colegio.',
    can: (can) => can('academics', 'read'),
  },
  { key: 'escalas', label: 'Escalas de calificación', icon: 'star', hint: 'Escala cuantitativa (0–20) o cualitativa (A–E) de cada grado.' },
  {
    key: 'pagos',
    label: 'Datos de pago',
    icon: 'wallet',
    hint: 'Tasa oficial del BCV y cuentas del colegio (pago móvil y transferencias) que ven los representantes al reportar un pago.',
  },
  { key: 'avanzado', label: 'Otros', long: '/ Avanzado', icon: 'settings', hint: 'Acceso a la plataforma y otros ajustes del sistema.' },
];
const FORM_TABS = ['general', 'apariencia'];

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

/**
 * Configuración del colegio organizada en pestañas (General, Apariencia,
 * Años escolares, Escalas de calificación, Otros). La pestaña activa vive en
 * la URL (?tab=…): se puede enlazar y se mantiene al recargar. Los cambios sin
 * guardar del formulario se conservan al cambiar de pestaña y se marcan con
 * un punto en la pestaña correspondiente.
 */
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

  // Vista previa EN VIVO en toda la plataforma mientras se editan los colores
  // (sin guardar). Al salir de la página o descartar, vuelve a lo guardado.
  const { setPreview } = useThemePreview();
  useEffect(() => {
    if (colorsValid) setPreview({ menuColor: form.secondaryColor, accentColor: form.primaryColor });
  }, [form.secondaryColor, form.primaryColor, colorsValid, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!colorsValid) return;

    const data = new FormData();
    data.append('name', form.name.trim());
    data.append('primaryColor', form.primaryColor);
    data.append('secondaryColor', form.secondaryColor);
    // Solo los dos colores: degradado, acento secundario y encabezados de
    // tabla se calculan en automático y ya no se envían.
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
  const saved = pickForm(settings);
  // Cambios sin guardar por pestaña (se marcan con un punto en su pestaña).
  const dirtyGeneral = Boolean(logoFile) || removeLogo || ['name', 'contactPhone', 'contactEmail'].some((k) => form[k] !== saved[k]);
  const dirtyAppearance = form.primaryColor !== saved.primaryColor || form.secondaryColor !== saved.secondaryColor;
  const dirty = dirtyGeneral || dirtyAppearance;
  const dirtyOf = { general: dirtyGeneral, apariencia: dirtyAppearance };

  // Pestaña activa en la URL (?tab=…).
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((t) => !t.can || t.can(can));
  const tab = tabs.find((t) => t.key === params.get('tab'))?.key || 'general';
  const active = tabs.find((t) => t.key === tab);
  const otherDirty = tab === 'general' ? dirtyAppearance : dirtyGeneral;
  const tabRefs = useRef({});

  const selectTab = (key, focus = false) => {
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (key === 'general') next.delete('tab');
        else next.set('tab', key);
        return next;
      },
      { replace: true },
    );
    if (focus) tabRefs.current[key]?.focus();
  };
  // Teclado (patrón de pestañas accesible): ← → recorren, Inicio/Fin van a los extremos.
  const onTabKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.key === tab);
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    selectTab(tabs[(go + tabs.length) % tabs.length].key, true);
  };

  return (
    <div>
      <PageHeader title="Configuración del colegio" subtitle="Institución, apariencia, años escolares y escalas de calificación" />

      <div className="settings-tabs" role="tablist" aria-label="Secciones de configuración" onKeyDown={onTabKeyDown}>
        {tabs.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${t.key}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${t.key}`}
              tabIndex={selected ? 0 : -1}
              className={`settings-tabs__tab ${selected ? 'is-active' : ''}`}
              onClick={() => selectTab(t.key)}
              title={t.hint}
            >
              <Icon name={t.icon} size={16} />
              <span>
                {t.label}
                {t.long && <span className="settings-tabs__long"> {t.long}</span>}
              </span>
              {dirtyOf[t.key] && <span className="settings-tabs__dirty" role="img" aria-label="Cambios sin guardar" title="Cambios sin guardar" />}
            </button>
          );
        })}
      </div>

      <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="settings-panel" key={tab}>
        <p className="settings-panel__hint text-sm text-muted">{active?.hint}</p>

        {FORM_TABS.includes(tab) && (
          <div className="grid settings-layout">
            <form onSubmit={handleSubmit} className="card">
              <Alert>{error}</Alert>

              {tab === 'general' ? (
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
                      placeholderUrl={DEFAULT_SCHOOL_LOGO.compact}
                      placeholderLabel="Logo predeterminado (MoDo Educa)"
                    />
                    {!logoFile && (!settings.logoUrl || removeLogo) && (
                      <span className="form-hint">Mientras el colegio no tenga logo propio, se muestra el de MoDo Educa en toda la plataforma.</span>
                    )}
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
                    <Input icon="user" name="contactPhone" value={form.contactPhone} onChange={handleChange} maxLength={30} disabled={!canEdit} />
                  </Field>
                </div>
              ) : (
                <div className="appearance-section appearance-section--tab">
                  <p className="text-sm text-muted">
                    Solo dos colores: el del menú y el de acento. Todo lo demás se ajusta solo. Verás el cambio en toda la plataforma al instante y
                    se guarda con «Guardar cambios».
                  </p>
                  <AppearanceEditor form={form} setForm={setForm} onChange={handleChange} fieldErrors={fieldErrors} disabled={!canEdit} />
                </div>
              )}

              <RequirePermission module="tenant_settings" action="update">
                {otherDirty && (
                  <p className="settings-panel__pending">
                    <Icon name="info" size={14} /> También hay cambios sin guardar en «{tab === 'general' ? 'Apariencia' : 'General'}»: se guardan
                    juntos.
                  </p>
                )}
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
        )}

        {tab === 'anios' && <SchoolPeriodsTab />}

        {/* Escala de calificación de cada grado: se guarda al instante, aparte del formulario. */}
        {tab === 'escalas' && <GradingScalesCard canEdit={canEdit} />}

        {tab === 'pagos' && (
          <>
            {/* Tasa BCV: se actualiza sola; aquí se ve su estado y se puede forzar. */}
            {can('payments', 'read') && <BcvRateCard />}
            <PaymentAccountsSettings canEdit={canEdit} />
          </>
        )}

        {tab === 'avanzado' && <AdvancedSettings settings={settings} />}
      </div>
    </div>
  );
}

export default TenantSettingsPage;
