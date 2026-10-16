import { useState } from 'react';
import { Link } from 'react-router-dom';
import paymentsApi from '../../../api/endpoints/payments.api';
import { getErrorMessage } from '../../../api/axiosClient';
import { useAuth } from '../../../context/AuthContext';
import { useFetch } from '../../../hooks/useFetch';
import Button from '../../../components/ui/Button';
import Alert from '../../../components/ui/Alert';
import Icon from '../../../components/ui/Icon';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { formatDate } from '../paymentStatus';
import { formatRate } from '../currency';
import SimulateBcvModal from './SimulateBcvModal';

export const SOURCE_LABELS = {
  bcv: 'BCV (bcv.org.ve)',
  bcv_api: 'BCV vía API de respaldo',
  manual: 'Registrada manualmente',
  simulated: 'Simulación (prueba)',
};

/** "hace 5 min", "hace 3 h", "ayer a las 15:20"… */
export function timeAgo(value) {
  if (!value) return '';
  const date = new Date(value);
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return date.toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' });
}

/** ['09:00', '13:00', '17:00'] → "09:00, 13:00 y 17:00" */
const joinTimes = (times = []) => (times.length > 1 ? `${times.slice(0, -1).join(', ')} y ${times[times.length - 1]}` : times[0] || '');

/**
 * Estado de la actualización automática (GET …/current → `sync`): si está
 * activa y cada cuánto, y el resultado del último intento.
 */
export function BcvSyncStatus({ sync, compact = false }) {
  if (!sync) return null;
  const { auto, last } = sync;
  return (
    <div className={`bcv-sync ${compact ? 'bcv-sync--compact' : ''}`}>
      <span className={`bcv-sync__auto ${auto.enabled ? 'is-on' : 'is-off'}`}>
        <span className="bcv-sync__dot" aria-hidden="true" />
        {auto.enabled ? `Actualización automática a las ${joinTimes(auto.times)} (hora de Venezuela)` : 'Actualización automática desactivada'}
      </span>
      {auto.enabled && auto.next_run_at && (
        <span className="text-muted">
          · Próxima: {new Date(auto.next_run_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })}
        </span>
      )}
      {last && last.status === 'ok' && (
        <span className="text-muted">
          · Última consulta {timeAgo(last.attempt_at)} ({last.trigger === 'manual' ? 'manual' : 'automática'}): correcta
        </span>
      )}
      {last && last.status === 'error' && (
        <span className="bcv-sync__error">
          <Icon name="alertTriangle" size={13} /> Última consulta {timeAgo(last.attempt_at)} falló
          {last.success_at ? ` · última exitosa ${timeAgo(last.success_at)}` : ''}
        </span>
      )}
      {!last && <span className="text-muted">· Aún no se ha consultado</span>}
    </div>
  );
}

/**
 * Tarjeta "Tasa oficial BCV": tasa vigente del bolívar (Bs por 1 USD), fecha
 * valor, origen y última actualización, la próxima tasa si ya se publicó, el
 * estado de la actualización automática y el botón «Actualizar tasa ahora».
 * Las cuotas pendientes, los reportes de pago y los totales en bolívares se
 * calculan con esta tasa (el servidor la aplica al consultar y al confirmar).
 */
function BcvRateCard() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useFetch(() => paymentsApi.currentRate(), []);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const canSync = can('payments', 'update');
  const ves = data?.currencies?.find((c) => c.code === 'VES');

  const sync = async () => {
    setSyncing(true);
    setLastError(null);
    try {
      const r = await paymentsApi.syncBcvRate();
      const effectiveNow = r.fetched.rate_date <= r.today;
      toast.success(
        `Tasa BCV: ${formatRate(r.fetched.rate, 'VES')}`,
        `${effectiveNow ? 'Vigente desde' : 'Regirá desde'} el ${formatDate(r.fetched.rate_date)} · ${SOURCE_LABELS[r.fetched.source]}`
      );
      refetch();
    } catch (err) {
      setLastError(getErrorMessage(err));
      refetch();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="card bcv-card">
      <div className="card__header">
        <div>
          <h3 className="card__title">Tasa oficial BCV</h3>
          <p className="card__subtitle">Bolívares por 1 USD. Se consulta sola al Banco Central de Venezuela; las cuotas en bolívares se calculan con ella.</p>
        </div>
        {canSync && ves && (
          <div className="bcv-card__actions">
            {/* Solo para pruebas (fuera de producción o con BCV_SIMULATION=true): no registra la tasa. */}
            {data?.sync?.auto?.simulation_enabled && (
              <Button size="sm" variant="ghost" icon="bell" onClick={() => setSimulating(true)}>
                Simular actualización BCV
              </Button>
            )}
            <Button size="sm" icon="trendingUp" onClick={sync} loading={syncing} loadingText="Consultando BCV…">
              Actualizar tasa ahora
            </Button>
          </div>
        )}
      </div>

      <Alert>{error}</Alert>
      {loading && !data ? (
        <Spinner />
      ) : !ves ? (
        <Alert variant="info">
          El colegio no tiene activado el bolívar (VES), así que no usa la tasa del BCV. Puedes activarlo en <Link to="/payments/currencies">Monedas y tasas</Link>.
        </Alert>
      ) : (
        <>
          <div className="bcv-card__body">
            <div className={`bcv-card__rate ${ves.stale ? 'is-stale' : ''}`}>
              {ves.current ? (
                <>
                  <span className="bcv-card__value">{formatRate(ves.current.rate, 'VES')}</span>
                  <span className="bcv-card__unit">por $1</span>
                </>
              ) : (
                <span className="bcv-card__value bcv-card__value--empty">Sin tasa</span>
              )}
            </div>
            <dl className="bcv-card__facts">
              <div>
                <dt>Fecha valor</dt>
                <dd>{ves.current ? formatDate(ves.current.rate_date) : '—'}</dd>
              </div>
              <div>
                <dt>Origen</dt>
                <dd>{ves.current ? SOURCE_LABELS[ves.current.source] || ves.current.source : '—'}</dd>
              </div>
              <div>
                <dt>Última actualización</dt>
                <dd>{ves.current ? timeAgo(ves.current.updated_at) : '—'}</dd>
              </div>
              {ves.next && (
                <div>
                  <dt>Próxima (ya publicada)</dt>
                  <dd>
                    {formatRate(ves.next.rate, 'VES')} desde el {formatDate(ves.next.rate_date)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          {ves.stale && (
            <div className="rate-card__note rate-card__note--warning">
              <Icon name="alertTriangle" size={14} />
              {ves.current ? `La tasa vigente tiene ${ves.age_days} días.` : 'Aún no hay tasa registrada.'} {canSync ? 'Pulsa «Actualizar tasa ahora».' : ''}
            </div>
          )}
          <BcvSyncStatus sync={data.sync} />
          {(lastError || data.sync?.last?.status === 'error') && (
            <Alert variant="warning">
              {lastError || data.sync.last.error}
              {canSync && (
                <>
                  {' '}
                  Mientras tanto puedes <Link to="/payments">registrarla manualmente</Link>.
                </>
              )}
            </Alert>
          )}
        </>
      )}
      {simulating && (
        <SimulateBcvModal suggested={ves?.current ? Math.round(ves.current.rate * 1.0035 * 10000) / 10000 : null} onClose={() => setSimulating(false)} />
      )}
    </section>
  );
}

export default BcvRateCard;
