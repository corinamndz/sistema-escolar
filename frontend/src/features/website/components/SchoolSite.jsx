import Icon from '../../../components/ui/Icon';
import RichTextView, { sanitizePreview } from '../../../components/ui/RichTextView';
import GalleryCarousel from './GalleryCarousel';
import { categoryOf, dateParts, longDate, timeLabel, todayStr } from '../../events/eventCatalog';

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
 * Plantillas de distribución. Todas usan los mismos bloques; cambia su ORDEN, la
 * portada y cómo se presentan las secciones adicionales:
 *   hero      centered (degradado centrado) · full (foto a pantalla completa) ·
 *             light (clara y sobria) · split (texto | foto)
 *   sections  stack (una debajo de otra) · alternate (foto y texto alternados) ·
 *             cards (tarjetas en cuadrícula)
 */
export const TEMPLATES = {
  classic: {
    label: 'Clásica',
    description: 'Portada centrada con degradado y bloques en columna.',
    hero: 'centered',
    sections: 'stack',
    order: ['about', 'pillars', 'sections', 'events', 'gallery', 'contact'],
  },
  modern: {
    label: 'Moderna con banner grande',
    description: 'Foto de portada a pantalla completa y secciones alternadas.',
    hero: 'full',
    sections: 'alternate',
    order: ['pillars', 'about', 'events', 'sections', 'gallery', 'contact'],
  },
  minimal: {
    label: 'Minimalista',
    description: 'Portada clara, mucho espacio y una sola columna.',
    hero: 'light',
    sections: 'stack',
    order: ['about', 'pillars', 'sections', 'events', 'gallery', 'contact'],
  },
  academic: {
    label: 'Enfoque académico',
    description: 'Portada dividida, misión y visión primero, secciones en tarjetas.',
    hero: 'split',
    sections: 'cards',
    order: ['pillars', 'events', 'sections', 'about', 'gallery', 'contact'],
  },
};

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

/** Bloque «Próximos eventos»: tarjetas con la fecha destacada, hora, lugar y un extracto. */
function UpcomingEvents({ events }) {
  return (
    <section id="site-eventos" className="site__section site__section--events">
      <div className="site__container">
        <span className="site__eyebrow">Agenda institucional</span>
        <h2>Próximos eventos</h2>
        <ol className="site__events">
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

/**
 * La página pública del colegio. Se usa igual en /colegio/<slug> y en la vista
 * previa del editor (preview: los enlaces se abren en otra pestaña y el texto de
 * las secciones, aún sin guardar, se sanea en el navegador). Se adapta al ANCHO
 * DE SU CONTENEDOR (container queries), no al de la ventana.
 *   school { name, logo_url, phone?, email?, address?, login_slug }
 *   site   { tagline, primary_color, secondary_color, banner_url, history, mission,
 *            vision, gallery (carrusel), gallery_autoplay, social, template, sections: [{ id, title, body_html, image_url, visible }] }
 *   events próximos eventos de la cartelera marcados para la web (ya filtrados y
 *          ordenados por el backend): [{ id, title, category, description, location,
 *          event_date, start_time, end_time }]. Sin eventos, el bloque no aparece.
 */
function SchoolSite({ school, site, preview = false, intake = null, intakeHref = null, events = [] }) {
  const tpl = TEMPLATES[site.template] || TEMPLATES.classic;
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
  const target = preview ? { target: '_blank', rel: 'noreferrer' } : {};
  const loginHref = school.login_slug ? `/${school.login_slug}/login` : null;
  const body = (html) => (preview ? sanitizePreview(html) : html);

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

  const blocks = {
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
        {tpl.sections === 'cards' ? (
          <section className="site__section">
            <div className="site__container site__cards">
              {sections.map((s, i) => (
                <article key={s.id || i} id={`site-${anchorOf(s, i)}`} className="site__card">
                  {s.image_url && <img src={assetUrl(s.image_url)} alt="" loading="lazy" />}
                  <div className="site__card-body">
                    {s.title && <h3>{s.title}</h3>}
                    {s.body_html && <RichTextView html={body(s.body_html)} className="site__rich" />}
                  </div>
                </article>
              ))}
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
    events: events.length > 0 && <UpcomingEvents key="events" events={events} />,
    gallery: gallery.length > 0 && (
      <section key="gallery" id="site-galeria" className="site__section site__section--tinted">
        <div className="site__container">
          <span className="site__eyebrow">Galería</span>
          <h2>Vida en el colegio</h2>
          <GalleryCarousel
            images={gallery.map((g, i) => ({ url: assetUrl(g.url), caption: g.caption || '', alt: `Foto ${i + 1} de ${school.name}` }))}
            autoplay={Boolean(site.gallery_autoplay)}
            label={`Galería de fotos de ${school.name}`}
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

  return (
    <div className={`site site--${TEMPLATES[site.template] ? site.template : 'classic'} site--hero-${tpl.hero}`} style={{ '--site-primary': primary, '--site-secondary': secondary }}>
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

      {tpl.hero === 'split' ? (
        <section id="site-top" className="site__hero site__hero--split">
          <div className="site__container site__split">
            <div className="site__split-text">
              {heroLogo}
              <h1>{school.name}</h1>
              {site.tagline && <p className="site__tagline">{site.tagline}</p>}
              {cta}
            </div>
            <div className="site__split-media" style={banner ? { backgroundImage: `url("${banner}")` } : undefined}>
              {!banner && <Icon name="graduation" size={64} />}
            </div>
          </div>
        </section>
      ) : (
        <section
          id="site-top"
          className={`site__hero site__hero--${tpl.hero} ${banner && tpl.hero !== 'light' ? 'has-banner' : ''}`}
          style={banner && tpl.hero !== 'light' ? { backgroundImage: `url("${banner}")` } : undefined}
        >
          <div className="site__hero-inner">
            {heroLogo}
            <h1>{school.name}</h1>
            {site.tagline && <p className="site__tagline">{site.tagline}</p>}
            {cta}
          </div>
          {tpl.hero === 'light' && banner && <img className="site__hero-photo" src={banner} alt="" />}
        </section>
      )}

      {tpl.order.map((k) => blocks[k] || null)}
      {blocks.intake || null}

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
