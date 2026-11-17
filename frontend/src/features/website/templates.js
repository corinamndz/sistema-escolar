/**
 * Catálogo de plantillas del sitio web del colegio.
 *
 * Cada plantilla es SOLO configuración: qué variante usa cada bloque y en qué
 * orden van. SchoolSite.jsx interpreta esta configuración; los colores siempre
 * son los del colegio (--site-primary / --site-secondary) y la tipografía la de
 * la plantilla salvo que el colegio elija otra. La base guarda solo la clave
 * (school_websites.template; backend website.service TEMPLATES y CHECK de la
 * migración 101). Agregar una plantilla = agregar una entrada aquí y su clave allá.
 *
 *   hero      centered · full · light · split · overlay · band · statement
 *   sections  stack · alternate · cards · news       (secciones adicionales)
 *   gallery   carousel · grid · mosaic
 *   events    cards · list                            (próximos eventos)
 *   quick     bar · tiles                             (accesos rápidos para familias y docentes)
 *   welcome   card · strip · quote                    (mensaje de bienvenida)
 *   font      sans · serif · rounded · elegant        (ver FONTS)
 *   order     bloques en orden: quick, welcome, about, pillars, sections, events, gallery, contact
 *             (la solicitud de cupo siempre va al final, antes del contacto)
 */

/** @typedef {'centered'|'full'|'light'|'split'|'overlay'|'band'|'statement'} HeroKind */
/**
 * @typedef {Object} SiteTemplate
 * @property {string} label
 * @property {string} description
 * @property {'institucional'|'moderno'|'escolar'|'informativo'} category
 * @property {HeroKind} hero
 * @property {'stack'|'alternate'|'cards'|'news'} sections
 * @property {'carousel'|'grid'|'mosaic'} gallery
 * @property {'cards'|'list'} events
 * @property {'bar'|'tiles'} quick
 * @property {'card'|'strip'|'quote'} welcome
 * @property {keyof typeof FONTS} font
 * @property {string[]} order
 */

export const CATEGORIES = {
  institucional: 'Institucionales',
  moderno: 'Modernas',
  escolar: 'Escolares',
  informativo: 'Informativas',
};

/** @type {Record<string, SiteTemplate>} */
export const TEMPLATES = {
  classic: {
    label: 'Clásica',
    description: 'Portada centrada con degradado y bloques en columna.',
    category: 'institucional',
    hero: 'centered',
    sections: 'stack',
    gallery: 'carousel',
    events: 'cards',
    quick: 'bar',
    welcome: 'card',
    font: 'sans',
    order: ['quick', 'welcome', 'about', 'pillars', 'sections', 'events', 'gallery', 'contact'],
  },
  academic: {
    label: 'Enfoque académico',
    description: 'Portada dividida, misión y visión primero, secciones en tarjetas.',
    category: 'institucional',
    hero: 'split',
    sections: 'cards',
    gallery: 'carousel',
    events: 'cards',
    quick: 'bar',
    welcome: 'card',
    font: 'sans',
    order: ['quick', 'pillars', 'events', 'sections', 'about', 'welcome', 'gallery', 'contact'],
  },
  prestige: {
    label: 'Tradición y prestigio',
    description: 'Foto de portada con panel elegante, tipografía con serifas y mensaje de la Dirección.',
    category: 'institucional',
    hero: 'overlay',
    sections: 'alternate',
    gallery: 'grid',
    events: 'list',
    quick: 'bar',
    welcome: 'quote',
    font: 'elegant',
    order: ['quick', 'welcome', 'about', 'pillars', 'sections', 'events', 'gallery', 'contact'],
  },
  modern: {
    label: 'Moderna con banner grande',
    description: 'Foto de portada a pantalla completa y secciones alternadas.',
    category: 'moderno',
    hero: 'full',
    sections: 'alternate',
    gallery: 'carousel',
    events: 'cards',
    quick: 'tiles',
    welcome: 'strip',
    font: 'sans',
    order: ['welcome', 'pillars', 'about', 'events', 'sections', 'quick', 'gallery', 'contact'],
  },
  minimal: {
    label: 'Minimalista',
    description: 'Portada clara, mucho espacio y una sola columna.',
    category: 'moderno',
    hero: 'light',
    sections: 'stack',
    gallery: 'grid',
    events: 'list',
    quick: 'bar',
    welcome: 'quote',
    font: 'sans',
    order: ['welcome', 'about', 'pillars', 'sections', 'events', 'gallery', 'quick', 'contact'],
  },
  contrast: {
    label: 'Contraste moderno',
    description: 'Portada oscura con titular grande, foto recortada y bloques en tarjetas.',
    category: 'moderno',
    hero: 'statement',
    sections: 'cards',
    gallery: 'grid',
    events: 'cards',
    quick: 'tiles',
    welcome: 'quote',
    font: 'sans',
    order: ['quick', 'about', 'pillars', 'events', 'sections', 'gallery', 'welcome', 'contact'],
  },
  showcase: {
    label: 'Galería protagonista',
    description: 'Portada a pantalla completa y las fotos en mosaico justo después.',
    category: 'moderno',
    hero: 'full',
    sections: 'alternate',
    gallery: 'mosaic',
    events: 'cards',
    quick: 'bar',
    welcome: 'strip',
    font: 'sans',
    order: ['gallery', 'welcome', 'about', 'pillars', 'sections', 'events', 'quick', 'contact'],
  },
  playful: {
    label: 'Escolar alegre',
    description: 'Formas redondeadas, colores cálidos y accesos grandes. Ideal para preescolar y primaria.',
    category: 'escolar',
    hero: 'split',
    sections: 'cards',
    gallery: 'mosaic',
    events: 'cards',
    quick: 'tiles',
    welcome: 'card',
    font: 'rounded',
    order: ['quick', 'welcome', 'about', 'pillars', 'events', 'gallery', 'sections', 'contact'],
  },
  magazine: {
    label: 'Noticias y agenda',
    description: 'Estilo editorial: portada compacta, agenda y novedades primero, fotos en mosaico.',
    category: 'informativo',
    hero: 'band',
    sections: 'news',
    gallery: 'mosaic',
    events: 'list',
    quick: 'bar',
    welcome: 'strip',
    font: 'serif',
    order: ['quick', 'events', 'sections', 'welcome', 'about', 'pillars', 'gallery', 'contact'],
  },
  portal: {
    label: 'Portal para familias',
    description: 'Práctica: accesos rápidos grandes para familias y docentes, y la agenda a la vista.',
    category: 'informativo',
    hero: 'band',
    sections: 'stack',
    gallery: 'carousel',
    events: 'list',
    quick: 'tiles',
    welcome: 'card',
    font: 'sans',
    order: ['quick', 'events', 'welcome', 'about', 'pillars', 'sections', 'gallery', 'contact'],
  },
};

/**
 * Tipografías del sitio. Solo se descargan las que usa la página que se está
 * viendo (useSiteFont): la plataforma no carga fuentes que nadie usa.
 */
export const FONTS = {
  sans: { label: 'Moderna (sin serifas)', heading: "var(--font-display, 'Plus Jakarta Sans'), sans-serif", body: "var(--font-sans, 'Inter'), sans-serif", google: null },
  serif: { label: 'Editorial (Lora)', heading: "'Lora', Georgia, serif", body: "var(--font-sans, 'Inter'), sans-serif", google: 'Lora:wght@500;600;700' },
  elegant: { label: 'Elegante (Playfair Display)', heading: "'Playfair Display', Georgia, serif", body: "var(--font-sans, 'Inter'), sans-serif", google: 'Playfair+Display:wght@600;700;800' },
  rounded: { label: 'Redondeada (Nunito)', heading: "'Nunito', 'Trebuchet MS', sans-serif", body: "'Nunito', 'Trebuchet MS', sans-serif", google: 'Nunito:wght@400;600;700;800' },
};

export const templateOf = (key) => TEMPLATES[key] || TEMPLATES.classic;
/** Tipografía efectiva: la elegida por el colegio o, si no eligió, la de la plantilla. */
export const fontOf = (site) => FONTS[site?.font] ? site.font : templateOf(site?.template).font;
