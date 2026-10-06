import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/ui/Icon';
import { DEFAULT_THEME, PRESETS, buildTheme, isHex, menuGradient } from '../../../theme/palette';

/** Selector de color: muestra + campo hex. */
export function ColorField({ label, name, value, onChange, error, disabled, hint }) {
  const valid = isHex(value);
  return (
    <Field label={label} hint={hint} error={error || (!valid ? 'Usa un color hex, ej. #2563EB' : null)}>
      <div className="color-field">
        <label className="color-field__swatch" style={{ background: valid ? value : '#fff' }} title="Elegir color">
          <input type="color" name={name} value={valid ? value : '#000000'} onChange={onChange} aria-label={label} disabled={disabled} />
        </label>
        <Input name={name} value={value} onChange={onChange} error={!valid || error} maxLength={7} disabled={disabled} />
      </div>
    </Field>
  );
}

/** Nivel de contraste WCAG legible para el usuario. */
function ContrastBadge({ ratio }) {
  const level = ratio >= 4.5 ? ['ok', 'Contraste óptimo'] : ratio >= 3 ? ['warn', 'Contraste justo'] : ['bad', 'Contraste bajo'];
  return (
    <span className={`contrast-badge contrast-badge--${level[0]}`} title={`Relación de contraste ${ratio.toFixed(1)}:1 (mínimo recomendado 4.5:1)`}>
      <Icon name={level[0] === 'ok' ? 'checkCircle' : 'alertTriangle'} size={12} /> {level[1]} · {ratio.toFixed(1)}:1
    </span>
  );
}

function Swatch({ color, label }) {
  return (
    <span className="theme-swatch">
      <span className="theme-swatch__chip" style={{ background: color }} />
      <span>
        {label}
        <code>{color}</code>
      </span>
    </span>
  );
}

const GRADIENTS = [
  { key: 'deep', label: 'Profundo', hint: 'Mismo tono, más intenso abajo' },
  { key: 'analogous', label: 'Armónico', hint: 'Hacia un tono vecino' },
  { key: 'solid', label: 'Sólido', hint: 'Sin degradado' },
];
const HEADERS = [
  { key: 'subtle', label: 'Suave', hint: 'Tinte del acento' },
  { key: 'solid', label: 'Intenso', hint: 'Acento pleno' },
  { key: 'neutral', label: 'Neutro', hint: 'Gris clásico' },
];

/**
 * Apariencia del colegio: dos selectores principales (menú y acento) y el
 * resto se calcula solo (degradado, hover, texto legible, encabezados…).
 * `form` usa los nombres del API: secondaryColor = menú, primaryColor = acento.
 */
function AppearanceEditor({ form, setForm, onChange, fieldErrors = {}, disabled }) {
  const { info } = buildTheme({
    menuColor: form.secondaryColor,
    accentColor: form.primaryColor,
    menuGradient: form.menuGradient,
    accentSecondaryColor: form.accentSecondaryColor || null,
    tableHeaderStyle: form.tableHeaderStyle,
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const menuValid = isHex(form.secondaryColor);
  const accentValid = isHex(form.primaryColor);

  return (
    <div className="appearance">
      <div className="appearance__presets">
        <span className="student-card__label">Combinaciones sugeridas</span>
        <div className="appearance__preset-list">
          {PRESETS.map((p) => {
            const active = form.secondaryColor.toUpperCase() === p.menuColor && form.primaryColor.toUpperCase() === p.accentColor;
            const g = menuGradient(p.menuColor, form.menuGradient);
            return (
              <button
                key={p.name}
                type="button"
                className={`appearance__preset ${active ? 'is-active' : ''}`}
                onClick={() => set({ secondaryColor: p.menuColor, primaryColor: p.accentColor })}
                disabled={disabled}
                aria-pressed={active}
                title={p.name}
              >
                <span className="appearance__preset-menu" style={{ background: `linear-gradient(170deg, ${g.start}, ${g.end})` }} />
                <span className="appearance__preset-accent" style={{ background: p.accentColor }} />
                <span className="appearance__preset-name">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 1 · Menú lateral */}
      <section className="appearance__block">
        <h4>
          <span className="gp-step">1</span> Color del menú
        </h4>
        <ColorField
          label="Color base del menú lateral"
          name="secondaryColor"
          value={form.secondaryColor}
          onChange={onChange}
          error={fieldErrors.secondaryColor}
          disabled={disabled}
          hint="El degradado se calcula solo a partir de este color."
        />
        <div className="appearance__segmented" role="radiogroup" aria-label="Estilo del degradado">
          {GRADIENTS.map((o) => {
            const g = menuValid ? menuGradient(form.secondaryColor, o.key) : { start: '#1E293B', end: '#0F172A' };
            return (
              <label key={o.key} className={`appearance__option ${form.menuGradient === o.key ? 'is-selected' : ''}`}>
                <input type="radio" name="menuGradient" value={o.key} checked={form.menuGradient === o.key} onChange={() => set({ menuGradient: o.key })} disabled={disabled} />
                <span className="appearance__option-swatch" style={{ background: `linear-gradient(170deg, ${g.start}, ${g.end})` }} />
                <strong>{o.label}</strong>
                <span className="text-sm text-muted">{o.hint}</span>
              </label>
            );
          })}
        </div>
        {menuValid && (
          <div className="appearance__derived">
            <Swatch color={info.menuStart} label="Inicio" />
            <Swatch color={info.menuEnd} label="Fin" />
            <Swatch color={info.menuFg} label="Texto del menú" />
            <ContrastBadge ratio={info.contrasts.menu} />
          </div>
        )}
      </section>

      {/* 2 · Acento */}
      <section className="appearance__block">
        <h4>
          <span className="gp-step">2</span> Color de acento
        </h4>
        <ColorField
          label="Botones, encabezados de tabla y elementos activos"
          name="primaryColor"
          value={form.primaryColor}
          onChange={onChange}
          error={fieldErrors.primaryColor}
          disabled={disabled}
        />
        <span className="student-card__label">Encabezados de tabla</span>
        <div className="appearance__segmented" role="radiogroup" aria-label="Estilo de los encabezados de tabla">
          {HEADERS.map((o) => {
            const h = accentValid ? buildTheme({ accentColor: form.primaryColor, tableHeaderStyle: o.key }).info.header : { bg: '#F8FAFC', fg: '#64748B' };
            return (
              <label key={o.key} className={`appearance__option ${form.tableHeaderStyle === o.key ? 'is-selected' : ''}`}>
                <input type="radio" name="tableHeaderStyle" value={o.key} checked={form.tableHeaderStyle === o.key} onChange={() => set({ tableHeaderStyle: o.key })} disabled={disabled} />
                <span className="appearance__option-header" style={{ background: h.bg, color: h.fg }}>
                  ALUMNO · NOTA
                </span>
                <strong>{o.label}</strong>
                <span className="text-sm text-muted">{o.hint}</span>
              </label>
            );
          })}
        </div>
        {accentValid && (
          <div className="appearance__derived">
            <Swatch color={info.accentHover} label="Al pasar el cursor" />
            <Swatch color={info.onAccent} label="Texto sobre el acento" />
            <ContrastBadge ratio={info.contrasts.button} />
            <Swatch color={info.accentText} label="Enlaces y textos" />
            {info.accentText !== info.accent && <span className="text-sm text-muted">Oscurecido automáticamente para que se lea bien sobre blanco.</span>}
          </div>
        )}
      </section>

      {/* Opciones avanzadas */}
      <details className="appearance__advanced">
        <summary>Opciones avanzadas</summary>
        <div className="appearance__advanced-body">
          <Field label="Acento secundario" hint="Para insignias y detalles. En automático se elige un tono que combina con el acento.">
            <div className="appearance__auto-row">
              <label className="appearance__check">
                <input
                  type="checkbox"
                  checked={!form.accentSecondaryColor}
                  onChange={(e) => set({ accentSecondaryColor: e.target.checked ? '' : info.accent2 })}
                  disabled={disabled}
                />
                Automático
              </label>
              {form.accentSecondaryColor ? (
                <ColorField label="Acento secundario" name="accentSecondaryColor" value={form.accentSecondaryColor} onChange={onChange} error={fieldErrors.accentSecondaryColor} disabled={disabled} />
              ) : (
                <Swatch color={info.accent2} label="Calculado" />
              )}
            </div>
          </Field>
          <div className="appearance__vars">
            <span className="student-card__label">Variables generadas</span>
            <div className="appearance__derived">
              <Swatch color={info.menuStart} label="--sidebar-bg-start" />
              <Swatch color={info.menuEnd} label="--sidebar-bg-end" />
              <Swatch color={info.accent} label="--color-primary" />
              <Swatch color={info.accentHover} label="--color-primary-hover" />
              <Swatch color={info.accentText} label="--color-primary-text" />
              <Swatch color={info.onAccent} label="--color-on-primary" />
              <Swatch color={info.accent2} label="--color-accent-2" />
              <Swatch color={info.header.bg} label="--table-head-bg" />
              <Swatch color={info.header.fg} label="--table-head-fg" />
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() =>
              set({
                secondaryColor: DEFAULT_THEME.menuColor,
                primaryColor: DEFAULT_THEME.accentColor,
                menuGradient: DEFAULT_THEME.menuGradient,
                accentSecondaryColor: '',
                tableHeaderStyle: DEFAULT_THEME.tableHeaderStyle,
              })
            }
            disabled={disabled}
          >
            <Icon name="arrowLeft" size={14} /> Restablecer colores por defecto
          </button>
        </div>
      </details>
    </div>
  );
}

/** Vista previa en miniatura del panel con la paleta en edición. */
export function ThemePreview({ form, logoUrl }) {
  const { info } = buildTheme({
    menuColor: form.secondaryColor,
    accentColor: form.primaryColor,
    menuGradient: form.menuGradient,
    accentSecondaryColor: form.accentSecondaryColor || null,
    tableHeaderStyle: form.tableHeaderStyle,
  });
  return (
    <div className="brand-preview">
      <div className="brand-preview__side" style={{ background: `linear-gradient(170deg, ${info.menuStart}, ${info.menuEnd})`, color: info.menuFg }}>
        <div className="brand-preview__brand">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="brand-preview__logo" style={{ background: '#fff', padding: 2 }} />
          ) : (
            <span className="brand-preview__logo" style={{ background: info.accent, color: info.onAccent }}>
              <Icon name="school" size={16} />
            </span>
          )}
          <span>{form.name || 'Nombre del colegio'}</span>
        </div>
        <div className="brand-preview__item" style={{ background: `${info.accent}40`, boxShadow: `inset 3px 0 0 ${info.accent}` }}>
          Inicio
        </div>
        <div className="brand-preview__item" style={{ opacity: 0.7 }}>
          Alumnos
        </div>
        <div className="brand-preview__item" style={{ opacity: 0.7 }}>
          Pagos
        </div>
      </div>
      <div className="brand-preview__main">
        <div className="brand-preview__table">
          <div className="brand-preview__thead" style={{ background: info.header.bg, color: info.header.fg, borderBottom: `1px solid ${info.header.border}` }}>
            <span>ALUMNO</span>
            <span>NOTA</span>
          </div>
          <div className="brand-preview__row">
            <span style={{ color: info.accentText, fontWeight: 600 }}>Ana Pérez</span>
            <span>18</span>
          </div>
          <div className="brand-preview__row">
            <span style={{ color: info.accentText, fontWeight: 600 }}>Luis Gómez</span>
            <span>15</span>
          </div>
        </div>
        <div className="brand-preview__input" style={{ borderColor: info.accent, boxShadow: `0 0 0 3px ${info.accent}33` }}>
          Campo activo
        </div>
        <div className="brand-preview__actions">
          <span className="brand-preview__btn" style={{ background: info.accent, color: info.onAccent }}>
            Botón principal
          </span>
          <span className="brand-preview__badge" style={{ background: info.accent2, color: readableBadge(info.accent2) }}>
            Insignia
          </span>
        </div>
      </div>
    </div>
  );
}

const readableBadge = (hex) => buildTheme({ accentColor: hex }).info.onAccent;

export default AppearanceEditor;
