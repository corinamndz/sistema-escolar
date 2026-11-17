import { useState } from 'react';
import { CATEGORIES, FONTS, TEMPLATES } from '../templates';

/**
 * Miniatura esquemática de una plantilla, generada a partir de su configuración
 * (portada + los primeros bloques en su orden). Es solo HTML/CSS: no descarga
 * imágenes, así que mostrar el catálogo completo no cuesta nada.
 */
function Mini({ block, t }) {
  switch (block) {
    case 'quick':
      return (
        <span className={`tpl-mini tpl-mini--quick-${t.quick}`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} />
          ))}
        </span>
      );
    case 'welcome':
      return <span className={`tpl-mini tpl-mini--welcome-${t.welcome}`} />;
    case 'pillars':
      return (
        <span className="tpl-mini tpl-mini--pair">
          <span />
          <span />
        </span>
      );
    case 'sections':
      return (
        <span className={`tpl-mini tpl-mini--sections-${t.sections}`}>
          {[0, 1, 2].map((i) => (
            <span key={i} />
          ))}
        </span>
      );
    case 'events':
      return (
        <span className={`tpl-mini tpl-mini--events-${t.events}`}>
          {[0, 1].map((i) => (
            <span key={i} />
          ))}
        </span>
      );
    case 'gallery':
      return (
        <span className={`tpl-mini tpl-mini--gallery-${t.gallery}`}>
          {[0, 1, 2].map((i) => (
            <span key={i} />
          ))}
        </span>
      );
    default:
      return <span className="tpl-mini tpl-mini--text" />;
  }
}

function Thumb({ id, t }) {
  const media = ['split', 'statement'].includes(t.hero);
  return (
    <span className={`tpl-thumb tpl-thumb--hero-${t.hero} tpl-thumb--${id}`} aria-hidden="true">
      <span className="tpl-thumb__bar" />
      <span className="tpl-thumb__hero">
        <span className="tpl-thumb__copy">
          <span className="tpl-thumb__title" />
          <span className="tpl-thumb__line" />
        </span>
        {media && <span className="tpl-thumb__media" />}
      </span>
      <span className="tpl-thumb__blocks">
        {t.order
          .filter((b) => b !== 'contact')
          .slice(0, 3)
          .map((b) => (
            <Mini key={b} block={b} t={t} />
          ))}
      </span>
    </span>
  );
}

/** Selector de plantilla (radio con miniaturas), con filtro por estilo. */
function TemplatePicker({ value, onChange }) {
  const [category, setCategory] = useState('');
  const entries = Object.entries(TEMPLATES).filter(([, t]) => !category || t.category === category);
  const counts = Object.values(TEMPLATES).reduce((acc, t) => ({ ...acc, [t.category]: (acc[t.category] || 0) + 1 }), {});
  return (
    <div className="tpl-catalog">
      <div className="tpl-filter" role="group" aria-label="Estilo de plantilla">
        {[['', 'Todas', Object.keys(TEMPLATES).length], ...Object.entries(CATEGORIES).filter(([k]) => counts[k]).map(([k, label]) => [k, label, counts[k]])].map(([k, label, n]) => (
          <button key={k || 'all'} type="button" className={`tpl-filter__item ${category === k ? 'is-active' : ''}`} aria-pressed={category === k} onClick={() => setCategory(k)}>
            {label} <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="tpl-picker" role="radiogroup" aria-label="Plantilla de diseño">
        {entries.map(([id, t]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={`tpl-option ${value === id ? 'is-selected' : ''}`} onClick={() => onChange(id)}>
            <Thumb id={id} t={t} />
            <strong>{t.label}</strong>
            <span className="tpl-option__desc">{t.description}</span>
            <span className="tpl-option__meta">
              {CATEGORIES[t.category]} · {FONTS[t.font].label.split(' (')[0]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default TemplatePicker;
