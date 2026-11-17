import { useEffect } from 'react';
import Icon from '../../../components/ui/Icon';
import RichTextView, { sanitizePreview } from '../../../components/ui/RichTextView';
import GalleryCarousel from './GalleryCarousel';
import { categoryOf, dateParts, longDate, timeLabel, todayStr } from '../../events/eventCatalog';
import { FONTS, TEMPLATES, fontOf, templateOf } from '../templates';

// El catálogo vive en ../templates.js; se reexporta por compatibilidad.
export { TEMPLATES };

/** /storage/... del API: en producción el API puede estar en otro dominio (VITE_API_URL). */
export const assetUrl = (url) => (url && url.startsWith('/') ? `${import.meta.env.VITE_API_URL || ''}${url}` : url || null);

export const SOCIAL_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X (Twitter)',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  website: 'Sitio web',
};

/**
 * Descarga la tipografía del sitio solo cuando se usa (una vez por familia):
 * la plataforma no carga fuentes que la página no necesita.
 */
export function useSiteFont(key) {
  useEffect(() => {
    const family = FONTS[key]?.google;
    if (!family || typeof document === 'undefined') return;
    const id = `site-font-${key}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
    document.head.appendChild(link);
  }, [key]);
}

/** Texto de varios párrafos: respeta los saltos de línea (sin HTML: nada se interpreta). */
const Paragraphs = ({ text }) =>
  String(text)
    .split(/\n{2,}/)
    .map((p, i) => <p key={i}>{p}</p>);

const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'C';

/** Ancla de una sección adicional (para el menú). */
const anchorOf = (s, i) => `extra-${s.id || i}`;

/** "Hoy" / "Mañana" para los eventos más cercanos. */
function relativeDay(date) {
  const today = todayStr();
  if (date === today) return 'Hoy';
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return date === t.toISOString().slice(0, 10) ? 'Mañana' : null;
}

/** Bloque «Próximos eventos»: tarjetas (cards) o agenda compacta (list). */
function UpcomingEvents({ events, variant }) {
  return (
    <section id="site-eventos" className={`site__section site__section--events site__section--events-${variant}`}>
      <div className="site__container">
        <span className="site__eyebrow">Agenda institucional</span>
        <h2>Próximos eventos</h2>
        <ol className={`site__events site__events--${variant}`}>
          {events.map((ev) => {
            const d = dateParts(ev.event_date);
            const cat = categoryOf(ev.category);
            const soon = relativeDay(ev.event_date);
            return (
              <li key={ev.id} className="site__event">
                <time className="site__event-date" dateTime={ev.event_date} title={longDate(ev.event_date)}>
                  <span>{d.month}</span>
                  <strong>{d.day}</strong>
                  <span>{d.weekday}</span>
                </time>
                <div className="site__event-body">
                  <div className="site__event-tags">
                    <span className="site__event-cat">
                      <Icon name={cat.icon} size={13} /> {cat.label}
                    </span>
                    {soon && <span className="site__event-soon">{soon}</span>}
                  </div>
                  <h3>{ev.title}</h3>
                  <p className="site__event-meta">
                    <span>
                      <Icon name="calendar" size={14} /> <span className="site__event-long">{longDate(ev.event_date)}</span>
                    </span>
                    <span>
                      <Icon name="clock" size={14} /> {ev.start_time ? timeLabel(ev) : 'Todo el día'}
                    </span>
                    {ev.location && (
                      <span>
                        <Icon name="building" size={14} /> {ev.location}
                      </span>
                    )}
                  </p>
                  {ev.description && <p className="site__event-desc">{ev.description}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** Galería: carrusel, cuadrícula o mosaico (la primera foto grande). */
function Gallery({ images, variant, autoplay, schoolName }) {
  if (variant === 'carousel') return <GalleryCarousel images={images} autoplay={autoplay} label={`Galería de fotos de ${schoolName}`} />;
  return (
    <ul className={`site__photos site__photos--${variant}`} aria-label={`Galería de fotos de ${schoolName}`}>
      {images.map((g, i) => (
        <li key={`${g.url}-${i}`}>
          <figure>
            <img src={g.url} alt={g.caption || g.alt} loading="lazy" />
            {g.caption && <figcaption>{g.caption}</figcaption>}
          </figure>
        </li>
      ))}
    </ul>
  );
}

/** Accesos rápidos para familias y docentes: franja (bar) o mosaicos grandes (tiles). */
function QuickLinks({ items, variant, onAnchor, target }) {
  const link = (q, children, className) =>
    q.anchor ? (
      <a key={q.key} href={`#site-${q.anchor}`} onClick={onAnchor(q.anchor)} className={className}>
        {children}
      </a>
    ) : (
      <a key={q.key} href={q.href} className={className} {...(q.external ? { target: '_blank', rel: 'noreferrer noopener' } : target)}>
        {children}
      </a>
    );
  return (
    <section className={`site__quick site__quick--${variant}`} aria-label="Accesos rápidos">
      <div className="site__container">
        {variant === 'tiles' && (
          <>
            <span className="site__eyebrow">Accesos rápidos</span>
            <h2>¿Qué necesitas hoy?</h2>
          </>
        )}
        <div className="site__quick-grid">
          {items.map((q) =>
            link(
              q,
              <>
                <span className="site__quick-icon">
                  <Icon name={q.icon} size={variant === 'tiles' ? 24 : 18} />
                </span>
                <span className="site__quick-text">
                  <strong>{q.title}</strong>
                  <small>{q.text}</small>
                </span>
                <Icon name="arrowRight" size={16} className="site__quick-go" />
              </>,
              `site__quick-item site__quick-item--${q.key}`
            )
          )}
        </div>
      </div>
    </section>
  );
}

/** Banner de bienvenida (p. ej. mensaje de la Dirección): tarjeta, franja o cita. */
function Welcome({ site, variant, logo }) {
  return (
    <section className={`site__section site__welcome site__welcome--${variant}`} aria-label="Mensaje de bienvenida">
      <div className="site__container">
        <div className="site__welcome-inner">
          {variant === 'card' && <span className="site__welcome-mark">{logo || <Icon name="megaphone" size={26} />}</span>}
          {variant === 'quote' && (
            <span className="site__welcome-quote" aria-hidden="true">
              “
            </span>
          )}
          <div className="site__welcome-body">
            {site.welcome_title && <h2>{site.welcome_title}</h2>}
            <div className="site__prose">
              <Paragraphs text={site.welcome_text} />
            </div>
            {site.welcome_signature && <p className="site__welcome-sign">— {site.welcome_signature}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * La página pública del colegio. Se usa igual en /colegio/<slug> y en la vista
 * previa del editor (preview: los enlaces se abren en otra pestaña y el texto de
 * las secciones, aún sin guardar, se sanea en el navegador). Se adapta al ANCHO
 * DE SU CONTENEDOR (container queries), no al de la ventana. La plantilla
 * (../templates.js) decide la variante de cada bloque y su orden; los colores y
 * el logo son siempre los del colegio.
 *   school { name, logo_url, phone?, email?, address?, login_slug }
 *   site   { tagline, primary_color, secondary_color, banner_url, history, mission,
 *            vision, gallery, gallery_autoplay, social, template, font,
 *            welcome_title, welcome_text, welcome_signature, show_quick_links,
 *            sections: [{ id, title, body_html, image_url, visible }] }
 *   events próximos eventos de la cartelera marcados para la web (ya filtrados y
 *          ordenados por el backend). Sin eventos, el bloque no aparece.
 */
function SchoolSite({ school, site, preview = false, intake = null, intakeHref = null, events = [] }) {
  const tplKey = TEMPLATES[site.template] ? site.template : 'classic';
  const tpl = templateOf(tplKey);
  const fontKey = fontOf(site);
  useSiteFont(fontKey);
  const font = FONTS[fontKey];
  const primary = site.primary_color || '#2563EB';
  const secondary = site.secondary_color || '#1E293B';
  const banner = assetUrl(site.banner_url);
  const logo = assetUrl(school.logo_url);
  const social = Object.entries(site.social || {}).filter(([, v]) => v);
  const gallery = (site.gallery || []).filter((g) => g.url);
  const sections = (site.sections || []).filter((s) => s.visible !== false && (s.title || s.body_html || s.image_url));
  const contact = [school.phone, school.email, school.address].some(Boolean);
  const hasAbout = Boolean(site.history);
  const hasPillars = Boolean(site.mission || site.vision);
  const hasWelcome = Boolean(site.welcome_text);
  const target = preview ? { target: '_blank', rel: 'noreferrer' } : {};
  const loginHref = school.login_slug ? `/${school.login_slug}/login` : null;
  const body = (html) => (preview ? sanitizePreview(html) : html);

  // Accesos rápidos: solo lo que el colegio realmente ofrece.
  const whatsapp = site.social?.whatsapp;
  const quick = [
    loginHref && { key: 'families', icon: 'users', title: 'Portal de familias', text: 'Notas, pagos, avisos y citas', href: loginHref },
    loginHref && { key: 'teachers', icon: 'graduation', title: 'Acceso docentes', text: 'Planificación, notas y asistencia', href: loginHref },
    intake && intakeHref && { key: 'intake', icon: 'clipboard', title: 'Solicitar cupo', text: `Inscripciones ${intake.school_period_name}`, href: intakeHref },
    events.length > 0 && { key: 'events', icon: 'calendar', title: 'Agenda', text: `${events.length} próximo${events.length === 1 ? '' : 's'} evento${events.length === 1 ? '' : 's'}`, anchor: 'eventos' },
    whatsapp
      ? { key: 'contact', icon: 'phone', title: 'Escríbenos', text: 'Por WhatsApp', href: whatsapp, external: true }
      : (contact || social.length > 0) && { key: 'contact', icon: 'phone', title: 'Contáctanos', text: school.phone || school.email || 'Teléfono y redes', anchor: 'contacto' },
  ].filter(Boolean);
  const showQuick = site.show_quick_links !== false && quick.length >= 2;

  // Menú: los bloques presentes, en el orden de la plantilla.
  const navOf = {
    about: hasAbout && [['nosotros', 'Nosotros']],
    pillars: !hasAbout && hasPillars && [['nosotros', 'Nosotros']],
    sections: sections.filter((s) => s.title).map((s) => [anchorOf(s, sections.indexOf(s)), s.title]),
    events: events.length > 0 && [['eventos', 'Eventos']],
    gallery: gallery.length > 0 && [['galeria', 'Galería']],
    contact: (contact || social.length > 0) && [['contacto', 'Contacto']],
  };
  const nav = tpl.order.flatMap((k) => navOf[k] || []);
  const go = (id) => (e) => {
    e.preventDefault();
    e.currentTarget.closest('.site')?.querySelector(`#site-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const brand = logo ? <img src={logo} alt="" /> : <span className="site__mark">{initials(school.name)}</span>;
  const heroLogo = logo ? <img className="site__hero-logo" src={logo} alt={`Logo de ${school.name}`} /> : <span className="site__hero-mark">{initials(school.name)}</span>;
  const cta = (
    <div className="site__cta">
      {intake && intakeHref && (
        <a href={intakeHref} {...target} className="site__btn site__btn--accent">
          Solicitar cupo <Icon name="arrowRight" size={16} />
        </a>
      )}
      {nav[0] && (
        <a href={`#site-${nav[0][0]}`} onClick={go(nav[0][0])} className="site__btn site__btn--primary">
          Conócenos
        </a>
      )}
      {loginHref && (
        <a href={loginHref} {...target} className="site__btn site__btn--outline">
          Portal de familias <Icon name="arrowRight" size={16} />
        </a>
      )}
    </div>
  );
  const heroText = (
    <>
      {heroLogo}
      <h1>{school.name}</h1>
      {site.tagline && <p className="site__tagline">{site.tagline}</p>}
      {cta}
    </>
  );

  let hero;
  if (tpl.hero === 'split' || tpl.hero === 'statement') {
    hero = (
      <section id="site-top" className={`site__hero site__hero--${tpl.hero}`}>
        <div className="site__container site__split">
          <div className="site__split-text">{heroText}</div>
          <div className="site__split-media" style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
            {!banner && <Icon name="graduation" size={64} />}
          </div>
        </div>
      </section>
    );
  } else if (tpl.hero === 'overlay') {
    hero = (
      <section id="site-top" className={`site__hero site__hero--overlay ${banner ? 'has-banner' : ''}`} style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
        <div className="site__container">
          <div className="site__overlay-panel">{heroText}</div>
        </div>
      </section>
    );
  } else if (tpl.hero === 'band') {
    hero = (
      <section id="site-top" className="site__hero site__hero--band">
        <div className="site__container site__band">
          {heroLogo}
          <div className="site__band-text">
            <h1>{school.name}</h1>
            {site.tagline && <p className="site__tagline">{site.tagline}</p>}
          </div>
          {cta}
        </div>
      </section>
    );
  } else {
    hero = (
      <section
        id="site-top"
        className={`site__hero site__hero--${tpl.hero} ${banner && tpl.hero !== 'light' ? 'has-banner' : ''}`}
        style={banner && tpl.hero !== 'light' ? { backgroundImage: `url("${banner}")` } : undefined}
      >
        <div className="site__hero-inner">{heroText}</div>
        {tpl.hero === 'light' && banner && <img className="site__hero-photo" src={banner} alt="" />}
      </section>
    );
  }

  const sectionCard = (s, i, extra = '') => (
    <article key={s.id || i} id={`site-${anchorOf(s, i)}`} className={`site__card ${extra}`}>
      {s.image_url && <img src={assetUrl(s.image_url)} alt="" loading="lazy" />}
      <div className="site__card-body">
        {s.title && <h3>{s.title}</h3>}
        {s.body_html && <RichTextView html={body(s.body_html)} className="site__rich" />}
      </div>
    </article>
  );

  const blocks = {
    quick: showQuick && <QuickLinks key="quick" items={quick} variant={tpl.quick} onAnchor={go} target={target} />,
    welcome: hasWelcome && <Welcome key="welcome" site={site} variant={tpl.welcome} logo={logo ? <img src={logo} alt="" /> : null} />,
    about: hasAbout && (
      <section key="about" id="site-nosotros" className="site__section site__section--about">
        <div className="site__container site__about">
          <span className="site__eyebrow">Nuestra historia</span>
          <h2>Quiénes somos</h2>
          <div className="site__prose">
            <Paragraphs text={site.history} />
          </div>
        </div>
      </section>
    ),
    pillars: hasPillars && (
      <section key="pillars" id={hasAbout ? undefined : 'site-nosotros'} className="site__section site__section--pillars">
        <div className="site__container">
          <div className="site__pillars">
            {site.mission && (
              <article className="site__pillar">
                <span className="site__pillar-icon">
                  <Icon name="star" size={20} />
                </span>
                <h3>Misión</h3>
                <div className="site__prose">
                  <Paragraphs text={site.mission} />
                </div>
              </article>
            )}
            {site.vision && (
              <article className="site__pillar">
                <span className="site__pillar-icon">
                  <Icon name="eye" size={20} />
                </span>
                <h3>Visión</h3>
                <div className="site__prose">
                  <Paragraphs text={site.vision} />
                </div>
              </article>
            )}
          </div>
        </div>
      </section>
    ),
    sections: sections.length > 0 && (
      <div key="sections" className={`site__extras site__extras--${tpl.sections}`}>
        {tpl.sections === 'cards' || tpl.sections === 'news' ? (
          <section className="site__section">
            <div className="site__container">
              {tpl.sections === 'news' && (
                <>
                  <span className="site__eyebrow">Novedades</span>
                  <h2>Lo que pasa en el colegio</h2>
                </>
              )}
              <div className={tpl.sections === 'news' ? 'site__news' : 'site__cards'}>{sections.map((s, i) => sectionCard(s, i, tpl.sections === 'news' && i === 0 ? 'is-lead' : ''))}</div>
            </div>
          </section>
        ) : (
          sections.map((s, i) => (
            <section key={s.id || i} id={`site-${anchorOf(s, i)}`} className={`site__section site__extra ${s.image_url ? 'has-image' : ''} ${tpl.sections === 'alternate' && i % 2 ? 'is-flipped' : ''}`}>
              <div className="site__container site__extra-inner">
                <div className="site__extra-text">
                  {s.title && <h2>{s.title}</h2>}
                  {s.body_html && <RichTextView html={body(s.body_html)} className="site__rich" />}
                </div>
                {s.image_url && <img className="site__extra-img" src={assetUrl(s.image_url)} alt="" loading="lazy" />}
              </div>
            </section>
          ))
        )}
      </div>
    ),
    events: events.length > 0 && <UpcomingEvents key="events" events={events} variant={tpl.events} />,
    gallery: gallery.length > 0 && (
      <section key="gallery" id="site-galeria" className={`site__section site__section--tinted site__section--gallery-${tpl.gallery}`}>
        <div className="site__container">
          <span className="site__eyebrow">Galería</span>
          <h2>Vida en el colegio</h2>
          <Gallery
            images={gallery.map((g, i) => ({ url: assetUrl(g.url), caption: g.caption || '', alt: `Foto ${i + 1} de ${school.name}` }))}
            variant={tpl.gallery}
            autoplay={Boolean(site.gallery_autoplay)}
            schoolName={school.name}
          />
        </div>
      </section>
    ),
    intake: intake && intakeHref && (
      <section key="intake" id="site-solicitud" className="site__section site__intake">
        <div className="site__container site__intake-inner">
          <div>
            <span className="site__eyebrow">Inscripciones {intake.school_period_name}</span>
            <h2>Solicitud de cupo abierta</h2>
            <p>Llena la solicitud en línea y el colegio se comunicará contigo. No necesitas una cuenta.</p>
          </div>
          <a href={intakeHref} {...target} className="site__btn site__btn--accent site__btn--big">
            Llenar la solicitud <Icon name="arrowRight" size={16} />
          </a>
        </div>
      </section>
    ),
    contact: (contact || social.length > 0) && (
      <section key="contact" id="site-contacto" className="site__section site__contact">
        <div className="site__container">
          <span className="site__eyebrow">Contacto</span>
          <h2>Estamos para atenderte</h2>
          <div className="site__contact-grid">
            {school.phone && (
              <a href={`tel:${school.phone.replace(/[^\d+]/g, '')}`} className="site__contact-item">
                <Icon name="phone" size={18} /> {school.phone}
              </a>
            )}
            {school.email && (
              <a href={`mailto:${school.email}`} className="site__contact-item">
                <Icon name="mail" size={18} /> {school.email}
              </a>
            )}
            {school.address && (
              <span className="site__contact-item">
                <Icon name="building" size={18} /> {school.address}
              </span>
            )}
          </div>
          {social.length > 0 && (
            <div className="site__social">
              {social.map(([k, url]) => (
                <a key={k} href={url} target="_blank" rel="noreferrer noopener" className="site__social-link">
                  <Icon name="link" size={15} /> {SOCIAL_LABELS[k] || k}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    ),
  };

  // La solicitud de cupo va antes del contacto (o al final si no hay contacto).
  const order = tpl.order.flatMap((k) => (k === 'contact' ? ['intake', 'contact'] : [k]));
  if (!order.includes('intake')) order.push('intake');

  return (
    <div
      className={`site site--${tplKey} site--hero-${tpl.hero} site--font-${fontKey}`}
      style={{ '--site-primary': primary, '--site-secondary': secondary, '--site-heading-font': font.heading, '--site-body-font': font.body }}
    >
      <header className="site__bar">
        <a href="#top" className="site__brand" onClick={go('top')}>
          {brand}
          <span>{school.name}</span>
        </a>
        <nav className="site__nav" aria-label="Secciones">
          {nav.slice(0, 5).map(([id, label]) => (
            <a key={id} href={`#site-${id}`} onClick={go(id)}>
              {label}
            </a>
          ))}
          {intake && intakeHref && (
            <a className="site__nav-intake" href={intakeHref} {...target}>
              Solicitar cupo
            </a>
          )}
          {loginHref && (
            <a className="site__portal" href={loginHref} {...target}>
              Portal de familias
            </a>
          )}
        </nav>
      </header>

      {hero}

      {order.map((k) => blocks[k] || null)}

      <footer className="site__footer">
        <span className="site__footer-brand">
          {brand}
          <span>
            © {new Date().getFullYear()} {school.name}
          </span>
        </span>
        <span className="site__credit">Sitio creado con MoDo Educa</span>
      </footer>
    </div>
  );
}

export default SchoolSite;
