import { useEffect, useState } from 'react';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useMutation } from '../../../hooks/useMutation';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import Switch from '../../../components/ui/Switch';

const PRESETS = {
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false },
};
const isGmail = (host) => /(^|\.)(gmail|googlemail)\.com$/i.test(String(host || '').trim());
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

const emptyForm = { host: PRESETS.gmail.host, port: 465, secure: true, username: '', fromName: '', password: '', enabled: false };

/**
 * Configuración → Correo → «Usar otro proveedor (SMTP)»: servidor, puerto y
 * contraseña (Gmail con contraseña de aplicación, Outlook o un SMTP
 * corporativo). La opción principal es «Conectar con Google» (MailSettingsCard). La contraseña se guarda
 * cifrada y nunca vuelve a la pantalla: el campo vacío conserva la guardada.
 * «Enviar correo de prueba» usa lo que está en el formulario (aunque no se
 * haya guardado) para comprobarlo antes de activar los envíos.
 */
function SmtpMailForm({ data, refetch, canEdit, schoolName }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const { run, loading: saving, error: saveError, fieldErrors } = useMutation(tenantApi.saveMailSettings);

  useEffect(() => {
    if (!data) return;
    setForm(
      data.provider === 'smtp'
        ? { host: data.host, port: data.port, secure: data.secure, username: data.username, fromName: data.from_name || '', password: '', enabled: data.enabled }
        : { ...emptyForm, fromName: schoolName || '' }
    );
    setTestTo((t) => t || (isEmail(user?.username) ? user.username : data.username || ''));
  }, [data, schoolName, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setPort = (e) => {
    const port = Number(e.target.value) || '';
    setForm((f) => ({ ...f, port, secure: port === 465 ? true : port === 587 ? false : f.secure }));
  };
  const applyPreset = (key) => setForm((f) => ({ ...f, host: PRESETS[key].host, port: PRESETS[key].port, secure: PRESETS[key].secure }));

  const gmail = isGmail(form.host);
  const hasStoredPassword = Boolean(data?.has_password && data?.password_readable);
  const passwordLen = form.password.replace(/\s+/g, '').length;
  const gmailPasswordBad = gmail && form.password && passwordLen !== 16;
  const canTest = form.host && form.port && isEmail(form.username) && isEmail(testTo) && (form.password || hasStoredPassword);

  const payload = () => ({
    host: form.host.trim(),
    port: Number(form.port),
    secure: Boolean(form.secure),
    username: form.username.trim(),
    fromName: form.fromName.trim(),
    password: form.password,
  });

  const save = async (e) => {
    e.preventDefault();
    try {
      await run({ ...payload(), enabled: form.enabled });
      toast.success('Correo guardado', form.enabled ? 'Los envíos automáticos están activados.' : 'Los envíos automáticos están desactivados.');
      setShowPassword(false);
      refetch();
    } catch {
      // errores visibles en el formulario
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await tenantApi.testMailSettings({ ...payload(), to: testTo.trim() });
      setTestResult(r);
      if (r.recorded) refetch();
    } catch (err) {
      setTestResult({ ok: false, error: getErrorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: '¿Quitar la configuración de correo?',
      message: data?.server_fallback
        ? 'Los correos se enviarán con el correo general del servidor, como antes.'
        : 'El sistema dejará de enviar correos a los representantes hasta que configures uno.',
      danger: true,
      confirmLabel: 'Quitar',
    });
    if (!ok) return;
    try {
      await tenantApi.deleteMailSettings();
      toast.success('Configuración de correo quitada');
      setTestResult(null);
      refetch();
    } catch (err) {
      toast.error('No se pudo quitar', getErrorMessage(err));
    }
  };

  return (
    <div className="mail-smtp">
      {data?.provider === 'google' && (
        <Alert variant="info">Hay una cuenta de Google conectada. Si guardas un servidor SMTP, se desconecta la cuenta de Google y se usa este servidor.</Alert>
      )}
      <Alert>{saveError}</Alert>
      {data?.provider === 'smtp' && !data.password_readable && (
        <Alert variant="warning">No se pudo leer la contraseña guardada (cambió la clave de cifrado del servidor). Vuelve a escribirla y guarda.</Alert>
      )}

      <form onSubmit={save} className="mail-settings">
        <div className="mail-settings__presets">
          <span className="text-sm text-muted">Configuración rápida:</span>
          {Object.entries(PRESETS).map(([key, p]) => (
            <button key={key} type="button" className={`chip mail-settings__preset ${form.host === p.host ? 'is-on' : ''}`} onClick={() => applyPreset(key)} disabled={!canEdit}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="form-grid">
          <Field label="Servidor SMTP" error={fieldErrors.host} required>
            <Input value={form.host} onChange={set('host')} placeholder="smtp.gmail.com" disabled={!canEdit} required />
          </Field>
          <div className="mail-settings__port">
            <Field label="Puerto" error={fieldErrors.port} required>
              <Input type="number" min="1" max="65535" value={form.port} onChange={setPort} disabled={!canEdit} required />
            </Field>
            <Field label="Seguridad">
              <Select value={form.secure ? 'tls' : 'starttls'} onChange={(e) => setForm((f) => ({ ...f, secure: e.target.value === 'tls' }))} disabled={!canEdit}>
                <option value="tls">SSL/TLS (465)</option>
                <option value="starttls">STARTTLS (587)</option>
              </Select>
            </Field>
          </div>
          <Field label="Correo remitente" error={fieldErrors.username} hint="La cuenta con que se inicia sesión; los correos salen desde aquí." required>
            <Input type="email" value={form.username} onChange={set('username')} placeholder="colegio@gmail.com" disabled={!canEdit} required autoComplete="off" />
          </Field>
          <Field label="Nombre del remitente" error={fieldErrors.fromName} hint="Lo que verán las familias como «De:».">
            <Input value={form.fromName} onChange={set('fromName')} placeholder={schoolName || 'Colegio'} maxLength={120} disabled={!canEdit} />
          </Field>
          <Field
            label={gmail ? 'Contraseña de aplicación' : 'Contraseña'}
            error={fieldErrors.password || (gmailPasswordBad ? `La contraseña de aplicación de Google tiene 16 letras (escribiste ${passwordLen}).` : null)}
            hint={hasStoredPassword ? 'Guardada y cifrada. Déjala vacía para conservarla, o escribe una nueva para cambiarla.' : gmail ? '16 letras que genera Google (ver abajo cómo obtenerla).' : undefined}
            required={!hasStoredPassword}
            full
          >
            <div className="mail-settings__password">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                placeholder={hasStoredPassword ? '•••• •••• •••• ••••  (guardada)' : 'abcd efgh ijkl mnop'}
                autoComplete="new-password"
                disabled={!canEdit}
              />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowPassword((v) => !v)} disabled={!form.password}>
                <Icon name="eye" size={15} /> {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
          </Field>
        </div>

        {gmail && (
          <details className="mail-settings__help">
            <summary>
              <Icon name="helpCircle" size={15} /> Cómo obtener la contraseña de aplicación de Gmail
            </summary>
            <ol>
              <li>
                Entra a la cuenta de Google del colegio y activa la <strong>verificación en 2 pasos</strong> (Seguridad → Verificación en 2 pasos).
              </li>
              <li>
                Abre <strong>myaccount.google.com/apppasswords</strong>, escribe un nombre (p. ej. «Sistema escolar») y pulsa <strong>Crear</strong>.
              </li>
              <li>
                Copia las <strong>16 letras</strong> que muestra Google y pégalas aquí. No uses la contraseña normal de la cuenta: Gmail la rechaza.
              </li>
            </ol>
            <p className="form-hint">Gmail permite unos 500 correos por día por cuenta. Para envíos mayores conviene un SMTP corporativo o Google Workspace.</p>
          </details>
        )}

        <div className="mail-settings__test">
          <div className="mail-settings__test-row">
            <Field label="Enviar correo de prueba a" hint="Se prueba lo que está en el formulario, aunque no lo hayas guardado.">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="tu-correo@ejemplo.com" disabled={!canEdit} />
            </Field>
            <Button type="button" variant="secondary" icon="mail" onClick={test} loading={testing} loadingText="Probando conexión…" disabled={!canEdit || !canTest}>
              Probar conexión y enviar
            </Button>
          </div>
          {testResult && (
            <Alert variant={testResult.ok ? 'success' : 'warning'}>
              {testResult.ok ? testResult.message : testResult.error}
            </Alert>
          )}
        </div>

        <div className="settings-switch">
          <Switch
            checked={form.enabled}
            onChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
            disabled={!canEdit}
            label="Activar envíos automáticos"
            description="Comprobantes de pago y avisos a los representantes. Te recomendamos enviar antes un correo de prueba."
          />
        </div>

        {canEdit && (
          <div className="form-actions">
            {data?.provider === 'smtp' && (
              <button type="button" className="link-button mail-settings__remove" onClick={remove}>
                Quitar configuración
              </button>
            )}
            <Button type="submit" loading={saving} disabled={gmailPasswordBad}>
              Guardar
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

/** Estado: envíos activos / desactivados y el resultado de la última prueba. */
export function MailStatus({ data }) {
  return (
    <div className="mail-status">
      <span className={`badge ${data.enabled ? 'badge--success' : 'badge--neutral'}`}>{data.enabled ? 'Envíos activos' : 'Envíos desactivados'}</span>
      {data.last_test && (
        <span className={`text-sm ${data.last_test.ok ? 'text-muted' : 'mail-status__error'}`} title={data.last_test.error || ''}>
          <Icon name={data.last_test.ok ? 'checkCircle' : 'alertTriangle'} size={13} /> Prueba {data.last_test.ok ? 'correcta' : 'fallida'} ·{' '}
          {new Date(data.last_test.at).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      )}
    </div>
  );
}

export default SmtpMailForm;
