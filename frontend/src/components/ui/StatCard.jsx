import { Link } from 'react-router-dom';
import Icon from './Icon';

const TONES = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  violet: '#7c3aed',
};

/**
 * Tarjeta KPI para dashboards.
 *
 *   <StatCard label="Alumnos activos" value={120} icon="graduation" tone="primary"
 *             to="/students" trend={{ value: '+4%', direction: 'up', label: 'vs. mes anterior' }} />
 *
 * `value === undefined` muestra un skeleton mientras carga. `trend` es opcional:
 * solo debe pasarse cuando hay un dato real con qué comparar.
 */
function StatCard({ label, value, icon, tone = 'primary', to, trend, hint, linkLabel = 'Ver detalle' }) {
  const style = { '--stat-tone': TONES[tone] || tone };

  const content = (
    <>
      <div className="stat-card__top">
        <div>
          <div className="stat-card__label">{label}</div>
          {value === undefined ? (
            <div className="stat-skeleton skeleton" />
          ) : (
            <div className="stat-card__value">{value}</div>
          )}
        </div>
        {icon && (
          <div className="stat-card__icon">
            <Icon name={icon} size={22} />
          </div>
        )}
      </div>

      {(trend || hint || to) && (
        <div className="stat-card__footer">
          {trend ? (
            <span>
              <span className={`trend trend--${trend.direction || 'flat'}`}>
                {trend.direction === 'up' && <Icon name="trendingUp" size={13} />}
                {trend.direction === 'down' && <Icon name="trendingDown" size={13} />}
                {trend.value}
              </span>{' '}
              {trend.label}
            </span>
          ) : (
            <span>{hint}</span>
          )}
          {to && (
            <span className="stat-card__link">
              {linkLabel} <Icon name="arrowRight" size={14} />
            </span>
          )}
        </div>
      )}
    </>
  );

  return to ? (
    <Link to={to} className="stat-card" style={style}>
      {content}
    </Link>
  ) : (
    <div className="stat-card" style={style}>
      {content}
    </div>
  );
}

export default StatCard;
