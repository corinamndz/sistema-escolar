import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import tenantApi from '../../../api/endpoints/tenant.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import Card from '../../../components/ui/Card';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import Switch from '../../../components/ui/Switch';
import { useToast } from '../../../components/ui/Toast';

const ICONS = { bcv_rate: 'trendingUp', payment_confirmed: 'receipt', school_event: 'calendar', sanction: 'shield', club_enrollment: 'star', parent_meeting: 'users', evaluation_plan: 'clipboard', evaluation_reminder: 'clock', payment_overdue: 'alertCircle', recognition: 'award' };
const CHANNELS = [
  { key: 'bell', label: 'Campana', icon: 'bell' },
  { key: 'email', label: 'Correo', icon: 'mail' },
];

/**
 * Configuración → Notificaciones: matriz de qué avisos salen por la campana
 * del sistema y cuáles por correo. Cada cambio se guarda al instante; el
 * backend consulta esta matriz antes de emitir cada aviso.
 */
function NotificationPreferencesCard({ canEdit }) {
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const { data, loading, error } = useFetch(() => tenantApi.getNotificationPreferences(), []);
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(null); // "evento:canal" que se está guardando

  useEffect(() => {
    if (data) setRows(data.events);
  }, [data]);

  const change = async (event, channel, enabled) => {
    const previous = rows;
    setRows((rs) => rs.map((r) => (r.key === event ? { ...r, [channel]: enabled } : r)));
    setSaving(`${event}:${channel}`);
    try {
      const saved = await tenantApi.saveNotificationPreferences([{ event, channel, enabled }]);
      setRows(saved.events);
    } catch (err) {
      setRows(previous);
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  if (loading && !data) return <Spinner />;
  const emailReady = data?.email?.ready;

  return (
    <Card title="Avisos por canal" subtitle="Los cambios se guardan al instante.">
      <Alert>{error}</Alert>
      {data && !emailReady && (
        <Alert variant="warning">
          El correo del colegio no está configurado o está desactivado: los avisos marcados para «Correo» no se enviarán hasta que lo configures en la pestaña{' '}
          <button type="button" className="link-button" onClick={() => setParams({ tab: 'correo' }, { replace: true })}>
            Correo
          </button>
          .
        </Alert>
      )}

      <div className="np-table" role="table" aria-label="Avisos por canal">
        <div className="np-table__head" role="row">
          <span role="columnheader">Aviso</span>
          {CHANNELS.map((c) => (
            <span key={c.key} role="columnheader" className="np-table__channel">
              <Icon name={c.icon} size={15} /> {c.label}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="np-table__row" role="row">
            <span role="cell" className="np-event">
              <span className="np-event__icon">
                <Icon name={ICONS[r.key] || 'bell'} size={16} />
              </span>
              <span className="np-event__text">
                <strong>{r.label}</strong>
                <span className="text-sm text-muted">{r.description}</span>
                <span className="np-event__to">
                  <Icon name="users" size={12} /> {r.recipients}
                </span>
                <RowSettings eventKey={r.key} settings={data?.settings} ranges={data?.settingsRanges} disabled={!canEdit} inactive={!r.bell && !r.email} />
              </span>
            </span>
            {CHANNELS.map((c) => (
              <span key={c.key} role="cell" className="np-table__channel">
                <Switch
                  checked={Boolean(r[c.key])}
                  onChange={(v) => change(r.key, c.key, v)}
                  disabled={!canEdit || saving === `${r.key}:${c.key}`}
                  ariaLabel={`${r.label} · ${c.label}`}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="form-hint np-note">
        Cada familia recibe solo lo que le corresponde: su pago, las sanciones y los clubes de sus hijos, y los eventos dirigidos al colegio, al grado o a la
        sección de sus hijos. La tasa BCV llega a todas las familias (y a la administración, por la campana).
      </p>
    </Card>
  );
}

/**
 * Ajustes de tiempo de los recordatorios automáticos, en la fila de su aviso.
 * Cada uno: { key (ajuste), before, after(n) } → "Recordar [− n +] días antes".
 * Con min 0, el 0 significa "sin recordatorio".
 */
const ROW_SETTINGS = {
  evaluation_reminder: [{ key: 'evaluationReminderDays', before: 'Enviar', after: (n) => `${n === 1 ? 'día antes (la víspera)' : 'días antes'} de cada evaluación` }],
  school_event: [{ key: 'eventReminderDays', before: 'Recordatorio automático', after: (n) => (n === 0 ? 'sin recordatorio' : `${n === 1 ? 'día antes' : 'días antes'} de cada evento`) }],
  parent_meeting: [
    {
      key: 'meetingReminderDays',
      before: 'Recordatorio automático',
      after: (n) => (n === 0 ? 'sin recordatorio' : `${n === 1 ? 'día antes' : 'días antes'} de cada cita (por los canales de la cita)`),
      // Las citas usan sus propios canales: el recordatorio no depende de los interruptores de esta fila.
      ignoresChannels: true,
    },
  ],
  payment_overdue: [
    { key: 'overdueIntervalDays', before: 'Repetir cada', after: (n) => `${n === 1 ? 'día' : 'días'} mientras la cuota siga impaga` },
    { key: 'overdueMaxReminders', before: 'Hasta', after: (n) => `${n === 1 ? 'recordatorio' : 'recordatorios'} por cuota` },
  ],
};

function RowSettings({ eventKey, settings, ranges, disabled, inactive }) {
  const items = ROW_SETTINGS[eventKey];
  if (!items || !settings || !ranges) return null;
  return (
    <span className="np-settings">
      {items.map((it, i) => (
        <SettingStepper
          key={it.key}
          item={it}
          value={settings[it.key]}
          range={ranges[it.key]}
          disabled={disabled}
          inactive={inactive && !it.ignoresChannels}
          hint={i === items.length - 1}
        />
      ))}
    </span>
  );
}

/** Selector − n + (o se escribe el número); se guarda al instante. */
function SettingStepper({ item, value, range, disabled, inactive, hint = true }) {
  const toast = useToast();
  const [current, setCurrent] = useState(value);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const clamp = (n) => Math.min(range.max, Math.max(range.min, n));

  const commit = async (next) => {
    const parsed = Number.parseInt(next, 10);
    const n = Number.isNaN(parsed) ? current : clamp(parsed);
    setDraft(String(n));
    if (n === current) return;
    const previous = current;
    setCurrent(n);
    setSaving(true);
    try {
      await tenantApi.saveNotificationSettings({ [item.key]: n });
      toast.success('Ajuste guardado', `${item.before} ${n} ${item.after(n)}.`);
    } catch (err) {
      setCurrent(previous);
      setDraft(String(previous));
      toast.error('No se pudo guardar', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const off = disabled || saving;
  return (
    <span className={`np-days ${inactive ? 'is-inactive' : ''}`}>
      <span className="np-days__label">{item.before}</span>
      <span className="np-days__stepper">
        <button type="button" onClick={() => commit(current - 1)} disabled={off || current <= range.min} aria-label="Menos">
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          value={draft}
          disabled={off}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label={`${item.before} … ${item.after(current)}`}
        />
        <button type="button" onClick={() => commit(current + 1)} disabled={off || current >= range.max} aria-label="Más">
          +
        </button>
      </span>
      <span className="np-days__label">
        {item.after(current)}
        {inactive && hint && ' · actívalo por campana o correo'}
      </span>
    </span>
  );
}

export default NotificationPreferencesCard;
