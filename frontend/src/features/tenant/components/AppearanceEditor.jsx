import Icon from '../../../components/ui/Icon';
import SchoolLogo from '../../../components/ui/SchoolLogo';
import { ACCENT_SWATCHES, DEFAULT_THEME, MENU_SWATCHES, PRESETS, isHex, menuGradient, themeFromColors } from '../../../theme/palette';

const upper = (v) => String(v || '').toUpperCase();
const gradientCss = (hex) => {
  const g = menuGradient(hex);
  return `linear-gradient(170deg, ${g.start}, ${g.end})`;
};

/**
 * Selector de UN color: muestras predefinidas + "Personalizado" (selector
 * nativo) + código hex para colores institucionales exactos.
 * `swatchStyle(hex)` dibuja cada muestra (el menú se ve con su degradado).
 */
function ColorChoice({ step, title, description, name, value, swatches, swatchStyle, onPick, onChange, error, disabled }) {
  const valid = isHex(value);
  const isCustom = valid && !swatches.some((s) => s.color === upper(value));
  return (
    <section className="color-choice" aria-labelledby={`${name}-title`}>
      <header className="color-choice__head">
        <span className="gp-step">{step}</span>
        <div>
          <h4 id={`${name}-title`}>{title}</h4>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </header>

      <div className="color-choice__grid" role="radiogroup" aria-labelledby={`${name}-title`}>
        {swatches.map((s) => {
          const selected = upper(value) === s.color;
          return (
            <button
              key={s.color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={s.name}
              title={s.name}
              className={`color-choice__swatch ${selected ? 'is-selected' : ''}`}
              style={swatchStyle(s.color)}
              onClick={() => onPick(s.color)}
              disabled={disabled}
            >
              {selected && <Icon name="check" size={16} />}
            </button>
          );
        })}
        {/* Personalizado: abre el selector de color del navegador. */}
        <label
          className={`color-choice__swatch color-choice__swatch--custom ${isCustom ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
          style={isCustom ? swatchStyle(upper(value)) : undefined}
          title="Color personalizado"
        >
          <input type="color" value={valid ? value.toLowerCase() : '#000000'} onChange={(e) => onPick(e.target.value.toUpperCase())} disabled={disabled} aria-label={`${title}: color personalizado`} />
          {isCustom ? <Icon name="check" size={16} /> : <Icon name="plus" size={16} />}
        </label>
      </div>

      <div className="color-choice__code">
        <span className="color-choice__dot" style={{ background: valid ? value : 'transparent' }} />
        <input
          name={name}
          value={value}
          onChange={onChange}
          maxLength={7}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${title}: código de color`}
          aria-invalid={!valid || Boolean(error)}
          className={`input color-choice__hex ${!valid || error ? 'input--error' : ''}`}
        />
        {(!valid || error) && <span className="color-choice__error">{error || 'Usa un código como #2563EB'}</span>}
      </div>
    </section>
  );
}

/**
 * Apariencia del colegio, simplificada a DOS colores:
 *   1. Menú lateral: su degradado y el color del texto se calculan solos.
 *   2. Acento: botones, enlaces, pestañas, encabezados de tabla y detalles.
 * Arriba, paletas rápidas que fijan los dos de un clic.
 * `form` usa los nombres del API: secondaryColor = menú, primaryColor = acento.
 */
function AppearanceEditor({ form, setForm, onChange, fieldErrors = {}, disabled }) {
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isDefault = upper(form.secondaryColor) === DEFAULT_THEME.menuColor && upper(form.primaryColor) === DEFAULT_THEME.accentColor;

  return (
    <div className="appearance">
      <div className="appearance__quick">
        <span className="student-card__label">Paletas rápidas</span>
        <div className="appearance__preset-list">
          {PRESETS.map((p) => {
            const active = upper(form.secondaryColor) === p.menuColor && upper(form.primaryColor) === p.accentColor;
            return (
              <button
                key={p.name}
                type="button"
                className={`appearance__preset ${active ? 'is-active' : ''}`}
                onClick={() => set({ secondaryColor: p.menuColor, primaryColor: p.accentColor })}
                disabled={disabled}
                aria-pressed={active}
              >
                <span className="appearance__preset-colors">
                  <span style={{ background: gradientCss(p.menuColor) }} />
                  <span style={{ background: p.accentColor }} />
                </span>
                <span className="appearance__preset-name">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="appearance__choices">
        <ColorChoice
          step="1"
          title="Color del menú"
          description="Menú lateral. El degradado y el color del texto se ajustan solos."
          name="secondaryColor"
          value={form.secondaryColor}
          swatches={MENU_SWATCHES}
          swatchStyle={(hex) => ({ background: gradientCss(hex), color: themeFromColors(hex).info.menuFg })}
          onPick={(hex) => set({ secondaryColor: hex })}
          onChange={onChange}
          error={fieldErrors.secondaryColor}
          disabled={disabled}
        />
        <ColorChoice
          step="2"
          title="Color de acento"
          description="Botones principales, enlaces, pestañas y detalles destacados."
          name="primaryColor"
          value={form.primaryColor}
          swatches={ACCENT_SWATCHES}
          swatchStyle={(hex) => ({ background: hex, color: themeFromColors(undefined, hex).info.onAccent })}
          onPick={(hex) => set({ primaryColor: hex })}
          onChange={onChange}
          error={fieldErrors.primaryColor}
          disabled={disabled}
        />
      </div>

      {!isDefault && (
        <button
          type="button"
          className="link-button appearance__reset"
          onClick={() => set({ secondaryColor: DEFAULT_THEME.menuColor, primaryColor: DEFAULT_THEME.accentColor })}
          disabled={disabled}
        >
          <Icon name="arrowLeft" size={14} /> Volver a los colores originales
        </button>
      )}
    </div>
  );
}

/** Vista previa en miniatura del panel con los dos colores en edición. */
export function ThemePreview({ form, logoUrl }) {
  const { info } = themeFromColors(form.secondaryColor, form.primaryColor);
  return (
    <div className="brand-preview">
      <div className="brand-preview__side" style={{ background: `linear-gradient(170deg, ${info.menuStart}, ${info.menuEnd})`, color: info.menuFg }}>
        <div className="brand-preview__brand">
          {/* Sin logo propio: el de MoDo Educa, igual que en el menú real. */}
          <SchoolLogo src={logoUrl} alt="" className="brand-preview__logo" style={{ background: '#fff', padding: 2 }} />
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
          <span className="brand-preview__badge" style={{ background: info.accent2, color: themeFromColors(undefined, info.accent2).info.onAccent }}>
            Insignia
          </span>
        </div>
      </div>
    </div>
  );
}

export default AppearanceEditor;
