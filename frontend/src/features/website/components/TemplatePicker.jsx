import { TEMPLATES } from './SchoolSite';

/** Miniatura esquemática de cada plantilla: cómo se reparten la portada y los bloques. */
function Thumb({ id }) {
  return (
    <span className={`tpl-thumb tpl-thumb--${id}`} aria-hidden="true">
      <span className="tpl-thumb__bar" />
      <span className="tpl-thumb__hero">
        <span className="tpl-thumb__title" />
        <span className="tpl-thumb__line" />
        {id === 'academic' && <span className="tpl-thumb__media" />}
      </span>
      <span className="tpl-thumb__blocks">
        {id === 'academic' ? (
          <>
            <span className="tpl-thumb__card" />
            <span className="tpl-thumb__card" />
            <span className="tpl-thumb__card" />
          </>
        ) : id === 'modern' ? (
          <>
            <span className="tpl-thumb__row" />
            <span className="tpl-thumb__row is-flipped" />
          </>
        ) : (
          <>
            <span className="tpl-thumb__text" />
            <span className="tpl-thumb__text is-short" />
          </>
        )}
      </span>
    </span>
  );
}

/** Selector de plantilla de distribución (radio con miniaturas). */
function TemplatePicker({ value, onChange }) {
  return (
    <div className="tpl-picker" role="radiogroup" aria-label="Plantilla de diseño">
      {Object.entries(TEMPLATES).map(([id, t]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={`tpl-option ${value === id ? 'is-selected' : ''}`} onClick={() => onChange(id)}>
          <Thumb id={id} />
          <strong>{t.label}</strong>
          <span>{t.description}</span>
        </button>
      ))}
    </div>
  );
}

export default TemplatePicker;
