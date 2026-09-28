import Icon from '../../components/ui/Icon';

/**
 * Presentación de los niveles educativos. Las REGLAS (modo de asignación,
 * auxiliar permitido) vienen del backend en cada grado/sección
 * (`assignment_mode`, `allows_assistant`); aquí solo hay textos y colores.
 */
export const LEVELS = {
  initial: {
    short: 'Inicial',
    name: 'Educación Inicial',
    icon: 'sparkles',
    rule: 'Cada sección tiene un docente titular y un docente auxiliar.',
  },
  primary: {
    short: 'Primaria',
    name: 'Educación Primaria',
    icon: 'school',
    rule: 'Cada sección tiene un único docente titular (maestra/o de grado).',
  },
  secondary: {
    short: 'Secundaria',
    name: 'Educación Secundaria',
    icon: 'clipboard',
    rule: 'Cada materia del grado tiene su propio profesor en cada sección.',
  },
};

export const LEVEL_CODES = Object.keys(LEVELS);

export function LevelBadge({ code, short = true }) {
  const level = LEVELS[code];
  if (!level) return null;
  return <span className={`badge badge--level badge--level-${code}`}>{short ? level.short : level.name}</span>;
}

/** Recuadro que explica la regla de asignación del nivel. */
export function LevelRule({ code }) {
  const level = LEVELS[code];
  if (!level) return null;
  return (
    <div className={`level-rule level-rule--${code}`}>
      <span className="level-rule__icon">
        <Icon name={level.icon} size={18} />
      </span>
      <div>
        <strong>{level.name}</strong>
        <div className="text-sm">{level.rule}</div>
      </div>
    </div>
  );
}

/** Filtro por nivel en forma de "pills" (Todos / Inicial / Primaria / Secundaria). */
export function LevelFilter({ value, onChange, counts }) {
  const options = [{ code: '', short: 'Todos' }, ...LEVEL_CODES.map((code) => ({ code, short: LEVELS[code].short }))];
  return (
    <div className="level-filter" role="group" aria-label="Filtrar por nivel">
      {options.map((o) => (
        <button
          key={o.code || 'all'}
          type="button"
          className={`level-filter__item ${value === o.code ? 'level-filter__item--active' : ''} ${o.code ? `level-filter__item--${o.code}` : ''}`}
          onClick={() => onChange(o.code)}
          aria-pressed={value === o.code}
        >
          {o.short}
          {counts && <span className="level-filter__count">{o.code ? counts[o.code] || 0 : Object.values(counts).reduce((a, b) => a + b, 0)}</span>}
        </button>
      ))}
    </div>
  );
}

export const teacherName = (t) => `${t.first_name} ${t.last_name}`;
