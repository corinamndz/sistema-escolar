import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import SmtpMailForm, { MailStatus } from './SmtpMailForm';

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

/** Motivos con que vuelve el regreso desde Google (?google=error&reason=…). */
const GOOGLE_ERRORS = {
  cancelled: 'Cancelaste la autorización en Google: la cuenta no se conectó.',
  missing_scope: 'No se concedió el permiso de enviar correos. Vuelve a conectar y deja marcada la casilla «Enviar correo electrónico en tu nombre».',
  no_refresh_token: 'Google no entregó la autorización permanente. Vuelve a intentarlo.',
  expired: 'La solicitud venció (pasaron más de 10 minutos). Vuelve a intentarlo.',
  invalid_state: 'La solicitud no es válida o ya se usó. Vuelve a pulsar «Conectar con Google».',
  no_email: 'No se pudo identificar la cuenta de Google. Vuelve a intentarlo.',
  unreachable: 'No se pudo contactar a Google desde el servidor. Vuelve a intentarlo en unos minutos.',
};

/** Logotipo «G» oficial de Google (4 colores), para el botón de acceso. */
export function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Botón con la identidad visual de Google (fondo blanco, «G» a color, borde gris). */
function GoogleButton({ children, onClick, loading, disabled }) {
  return (
    <button type="button" className="gsi-button" onClick={onClick} disabled={disabled || loading} aria-busy={loading || undefined}>
      <span className="gsi-button__icon">{loading ? <span className="btn__spinner" /> : <GoogleLogo />}</span>
      <span className="gsi-button__text">{children}</span>
    </button>
  );
}

/**
 * Configuración → Correo. Lo principal es «Conectar con Google»: el colegio
 * autoriza (en la pantalla de Google) que la plataforma ENVÍE correos desde su
 * cuenta de Gmail — sin servidores ni contraseñas. Como alternativa, un
 * servidor SMTP (Outlook, correo corporativo…).
 */
function MailSettingsCard({ canEdit, schoolName }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, refetch } = useFetch(() => tenantApi.getMailSettings(), []);
  const [connecting, setConnecting] = useState(false);
  const [showSmtp, setShowSmtp] = useState(false);

  // Resultado del regreso desde Google: aviso y se limpia la URL.
  useEffect(() => {
    const result = params.get('google');
    if (!result) return;
    if (result === 'connected') toast.success('Cuenta de Google conectada', 'El sistema ya puede enviar correos desde esa cuenta.');
    else toast.error('No se conectó la cuenta de Google', GOOGLE_ERRORS[params.get('reason')] || 'Google rechazó la autorización. Vuelve a intentarlo.');
    const next = new URLSearchParams(params);
    next.delete('google');
    next.delete('reason');
    setParams(next, { replace: true });
  }, [params, setParams, toast]);

  useEffect(() => {
    if (data?.provider === 'smtp') setShowSmtp(true);
  }, [data]);

  /** `hint`: cuenta sugerida en la pantalla de Google (al reconectar la misma). */
  const connect = async (hint) => {
    setConnecting(true);
    try {
      const { url } = await tenantApi.connectGoogleMail(typeof hint === 'string' ? hint : undefined);
      window.location.assign(url); // pantalla de consentimiento de Google; vuelve a esta pestaña
    } catch (err) {
      toast.error('No se pudo iniciar la conexión', getErrorMessage(err));
      setConnecting(false);
    }
  };

  if (loading && !data) return <Spinner />;
  const connected = data?.provider === 'google';
  // «Conectar con Google» solo se ofrece si el servidor tiene la app de Google
  // configurada (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Mientras no, la
  // pantalla muestra únicamente el formulario SMTP, sin avisos.
  const googleEnabled = Boolean(data?.google?.available) || connected;

  if (!googleEnabled) {
    return (
      <Card
        title="Correo de la institución"
        subtitle="Servidor SMTP con que el sistema envía correos a los representantes: comprobantes de pago y otros avisos."
        actions={data?.configured && <MailStatus data={data} />}
      >
        <Alert>{error}</Alert>
        {data && !data.configured && (
          <p className="text-sm text-muted mail-smtp__note">
            {data.server_fallback
              ? 'Aún no configuraste un correo propio: por ahora los correos salen con el correo general del servidor.'
              : 'Aún no hay un correo configurado: el sistema no está enviando correos a los representantes.'}
          </p>
        )}
        <SmtpMailForm data={data} refetch={refetch} canEdit={canEdit} schoolName={schoolName} />
      </Card>
    );
  }

  return (
    <Card
      title="Correo de la institución"
      subtitle="Con esta cuenta el sistema envía correos a los representantes: comprobantes de pago y otros avisos."
      actions={data?.configured && <MailStatus data={data} />}
    >
      <Alert>{error}</Alert>

      {connected ? (
        <GoogleConnected data={data} canEdit={canEdit} onConnect={connect} reconnecting={connecting} refetch={refetch} />
      ) : (
        <div className="mail-google">
          <div className="mail-google__intro">
            <strong>Conecta la cuenta de Gmail del colegio</strong>
            <span className="text-sm text-muted">
              Google te pedirá iniciar sesión y autorizar el envío de correos. El sistema solo podrá <strong>enviar</strong> correos desde esa
              cuenta: no puede leer, borrar ni ver tu bandeja.
            </span>
          </div>
          <GoogleButton onClick={() => connect()} loading={connecting} disabled={!canEdit}>
            Conectar con Google
          </GoogleButton>
          {data && !data.configured && (
            <p className="text-sm text-muted">
              {data.server_fallback
                ? 'Mientras no conectes una cuenta, los correos salen con el correo general del servidor.'
                : 'Mientras no conectes una cuenta, el sistema no envía correos a los representantes.'}
            </p>
          )}
        </div>
      )}

      <div className="mail-alt">
        <button type="button" className="link-button mail-alt__toggle" onClick={() => setShowSmtp((v) => !v)} aria-expanded={showSmtp}>
          <Icon name={showSmtp ? 'chevronDown' : 'chevronRight'} size={14} /> Usar otro proveedor (SMTP: Outlook, correo corporativo…)
        </button>
        {showSmtp && <SmtpMailForm data={data} refetch={refetch} canEdit={canEdit} schoolName={schoolName} />}
      </div>
    </Card>
  );
}

/** Cuenta de Google conectada: estado, remitente, envíos activos, prueba y desconexión. */
function GoogleConnected({ data, canEdit, onConnect, reconnecting, refetch }) {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const g = data.google;
  const [fromName, setFromName] = useState(data.from_name || '');
  const [enabled, setEnabled] = useState(data.enabled);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState(isEmail(user?.username) ? user.username : g.email);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    setFromName(data.from_name || '');
    setEnabled(data.enabled);
  }, [data.from_name, data.enabled]);

  const dirty = fromName !== (data.from_name || '') || enabled !== data.enabled;

  const save = async () => {
    setSaving(true);
    try {
      await tenantApi.updateGoogleMail({ fromName, enabled });
      toast.success('Cambios guardados', enabled ? 'Envíos automáticos activados.' : 'Envíos automáticos desactivados.');
      refetch();
    } catch (err) {
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await tenantApi.testGoogleMail(testTo.trim()));
      refetch();
    } catch (err) {
      setTestResult({ ok: false, error: getErrorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: `¿Desconectar ${g.email}?`,
      message: `Se retira en Google el permiso de envío y el sistema dejará de enviar correos desde esa cuenta${
        data.server_fallback ? ' (se usará el correo general del servidor)' : ''
      }.`,
      danger: true,
      confirmLabel: 'Desconectar',
    });
    if (!ok) return;
    try {
      await tenantApi.disconnectGoogleMail();
      toast.success('Cuenta desconectada', g.email);
      refetch();
    } catch (err) {
      toast.error('No se pudo desconectar', getErrorMessage(err));
    }
  };

  return (
    <div className="mail-google mail-google--connected">
      <div className="mail-google__account">
        <span className="mail-google__logo">
          <GoogleLogo size={22} />
        </span>
        <span className="mail-google__who">
          <strong>{g.email}</strong>
          <span className="text-sm text-muted">
            Cuenta de Google conectada
            {g.connected_at ? ` · desde el ${new Date(g.connected_at).toLocaleDateString('es-VE', { dateStyle: 'medium' })}` : ''} · permiso: solo enviar
          </span>
        </span>
        <span className={`mail-google__dot ${g.error ? 'is-error' : 'is-ok'}`} aria-label={g.error ? 'Con problemas' : 'Conectada'} />
      </div>

      {g.error && (
        <Alert variant="warning">
          {g.error}{' '}
          {canEdit && (
            <button type="button" className="link-button" onClick={() => onConnect(g.email)} disabled={reconnecting}>
              Reconectar ahora
            </button>
          )}
        </Alert>
      )}

      <div className="form-grid">
        <Field label="Nombre del remitente" hint="Lo que verán las familias como «De:».">
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={120} disabled={!canEdit} />
        </Field>
        <label className="mail-settings__enable mail-google__enable">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!canEdit} />
          <span>
            <strong>Envíos automáticos activados</strong>
            <span className="form-hint">Comprobantes de pago y avisos a los representantes.</span>
          </span>
        </label>
      </div>
      {canEdit && dirty && (
        <div className="form-actions">
          <Button type="button" onClick={save} loading={saving}>
            Guardar cambios
          </Button>
        </div>
      )}

      <div className="mail-settings__test">
        <div className="mail-settings__test-row">
          <Field label="Probar envío a" hint="Envía un correo real desde la cuenta conectada.">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} disabled={!canEdit} />
          </Field>
          <Button type="button" variant="secondary" icon="mail" onClick={test} loading={testing} loadingText="Enviando…" disabled={!canEdit || !isEmail(testTo)}>
            Probar envío
          </Button>
        </div>
        {testResult && <Alert variant={testResult.ok ? 'success' : 'warning'}>{testResult.ok ? testResult.message : testResult.error}</Alert>}
      </div>

      {canEdit && (
        <div className="mail-google__actions">
          <button type="button" className="link-button" onClick={() => onConnect()} disabled={reconnecting}>
            Cambiar de cuenta
          </button>
          <Button type="button" variant="danger" icon="logout" onClick={disconnect}>
            Desconectar cuenta
          </Button>
        </div>
      )}
    </div>
  );
}

export default MailSettingsCard;
