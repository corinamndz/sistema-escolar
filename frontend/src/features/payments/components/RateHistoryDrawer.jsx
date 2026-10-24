import { useMemo, useState } from 'react';
import paymentsApi from '../../../api/endpoints/payments.api';
import { useFetch } from '../../../hooks/useFetch';
import Drawer from '../../../components/ui/Drawer';
import Badge from '../../../components/ui/Badge';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import { formatDate } from '../paymentStatus';
import { formatRate } from '../currency';

const SOURCE_LABELS = { bcv: 'BCV', bcv_api: 'BCV (respaldo)', manual: 'Manual' };

/** Rangos rápidos por fecha valor (días hacia atrás; null = todo). */
const PRESETS = [
  { key: 'all', label: 'Todo', days: null },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
  { key: 'year', label: 'Este año', days: 'year' },
  { key: 'custom', label: 'Rango…' },
];

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(preset) {
  if (!preset.days) return { from: '', to: '' };
  const now = new Date();
  if (preset.days === 'year') return { from: `${now.getFullYear()}-01-01`, to: '' };
  const from = new Date(now);
  from.setDate(from.getDate() - preset.days);
  return { from: isoLocal(from), to: '' };
}

const weekdayDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
};
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const text = new Date(y, m - 1, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const dateTime = (v) => new Date(v).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (n) => `${n > 0 ? '+' : ''}${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

/**
 * Historial de cambios de la tasa de una moneda (panel lateral): cada alta,
 * corrección y eliminación, con la fecha desde la que rige, quién la registró
 * (o el sistema, si vino de la sincronización con el BCV) y la variación.
 */
function RateHistoryDrawer({ currency, onClose }) {
  const [preset, setPreset] = useState('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const { data, loading, error } = useFetch(() => paymentsApi.rateHistory(currency.code, range), [currency.code, range.from, range.to]);

  const choose = (p) => {
    setPreset(p.key);
    if (p.key !== 'custom') setRange(presetRange(p));
  };

  // Agrupado por mes de la fecha valor, conservando el orden (más reciente primero).
  const groups = useMemo(() => {
    const out = [];
    for (const item of data?.items || []) {
      const key = item.rate_date.slice(0, 7);
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: monthLabel(item.rate_date), items: [] });
      out[out.length - 1].items.push(item);
    }
    return out;
  }, [data]);

  const filtered = Boolean(range.from || range.to);
  const invalidRange = range.from && range.to && range.from > range.to;

  return (
    <Drawer
      title={`Historial de tasas · ${currency.code}`}
      subtitle={`${currency.name}: ${currency.symbol} por 1 USD`}
      icon="clock"
      onClose={onClose}
      footer={
        data && (
          <span className="text-sm text-muted">
            {filtered ? `${data.items.length} de ${data.total} cambios` : `${data.total} cambio${data.total === 1 ? '' : 's'} registrado${data.total === 1 ? '' : 's'}`}
            {data.truncated && ' · se muestran los más recientes'}
          </span>
        )
      }
    >
      {data?.current && (
        <div className="rate-log__summary">
          <span className="rate-log__summary-label">Tasa vigente</span>
          <strong>{formatRate(data.current.rate, currency.code)}</strong>
          <span className="text-sm text-muted">
            Desde el {formatDate(data.current.rate_date)} · {SOURCE_LABELS[data.current.source] || data.current.source}
          </span>
        </div>
      )}

      <div className="rate-log__filters">
        <div className="segmented" role="tablist" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={preset === p.key}
              className={`segmented__item ${preset === p.key ? 'segmented__item--active' : ''}`}
              onClick={() => choose(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="rate-log__range">
            <label>
              Desde
              <input type="date" className="input input--sm" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </label>
            <label>
              Hasta
              <input type="date" className="input input--sm" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </label>
            {filtered && (
              <button type="button" className="link-button" onClick={() => setRange({ from: '', to: '' })}>
                Limpiar
              </button>
            )}
          </div>
        )}
      </div>

      {invalidRange ? (
        <Alert variant="warning">La fecha "Desde" debe ser anterior a "Hasta".</Alert>
      ) : (
        <Alert>{error}</Alert>
      )}

      {loading && !data ? (
        <Spinner label="Cargando historial…" />
      ) : groups.length === 0 ? (
        <div className="rate-log__empty">
          <Icon name="calendar" size={28} />
          <p>{filtered ? 'No hay cambios de tasa con fecha valor en ese período.' : 'Todavía no se ha registrado ninguna tasa para esta moneda.'}</p>
        </div>
      ) : (
        <div className={`rate-log ${loading ? 'is-loading' : ''}`}>
          {groups.map((g) => (
            <section key={g.key}>
              <h4 className="rate-log__month">{g.label}</h4>
              <ol className="rate-log__list">
                {g.items.map((item) => (
                  <HistoryItem key={item.id} item={item} code={currency.code} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function HistoryItem({ item, code }) {
  const deleted = item.action === 'deleted';
  const who = item.changed_by_name || (item.source === 'manual' ? 'Usuario eliminado' : 'Sistema (automática)');
  return (
    <li className={`rate-log__item ${item.is_current ? 'is-current' : ''} ${deleted ? 'is-deleted' : ''}`}>
      <span className="rate-log__dot" aria-hidden="true" />
      <div className="rate-log__date">
        <strong>{weekdayDay(item.rate_date)}</strong>
        <span>Fecha valor</span>
      </div>
      <div className="rate-log__main">
        <div className="rate-log__rate">
          <strong>{formatRate(item.rate, code)}</strong>
          {item.change_pct !== null && item.change_pct !== 0 && !deleted && (
            <span className={`rate-log__change ${item.change_pct > 0 ? 'is-up' : 'is-down'}`}>
              <Icon name={item.change_pct > 0 ? 'trendingUp' : 'trendingDown'} size={13} /> {pct(item.change_pct)}
            </span>
          )}
        </div>
        {item.action === 'updated' && (
          <div className="rate-log__note">
            Corregida: antes {formatRate(item.previous_rate, code)}
          </div>
        )}
        <div className="rate-log__meta">
          <span className="chip">{SOURCE_LABELS[item.source] || item.source}</span>
          <span>
            {deleted ? 'Eliminada por' : 'Registrada por'} {who} · {dateTime(item.changed_at)}
          </span>
        </div>
      </div>
      <div className="rate-log__tags">
        {item.is_current && <Badge variant="success">Vigente</Badge>}
        {item.is_scheduled && <Badge variant="info">Programada</Badge>}
        {item.action === 'updated' && <Badge variant="warning">Corrección</Badge>}
        {deleted && <Badge variant="danger">Eliminada</Badge>}
      </div>
    </li>
  );
}

export default RateHistoryDrawer;
