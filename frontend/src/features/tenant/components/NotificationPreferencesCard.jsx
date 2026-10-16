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

const ICONS = { bcv_rate: 'trendingUp', payment_confirmed: 'receipt', school_event: 'calendar', sanction: 'shield', club_enrollment: 'star' };
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

export default NotificationPreferencesCard;
