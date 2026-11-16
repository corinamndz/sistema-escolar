import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import websiteApi from '../../../api/endpoints/website.api';
import { getErrorMessage, getFieldErrors } from '../../../api/axiosClient';
import { useFetch } from '../../../hooks/useFetch';
import PageHeader from '../../../components/ui/PageHeader';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Alert from '../../../components/ui/Alert';
import Spinner from '../../../components/ui/Spinner';
import Icon from '../../../components/ui/Icon';
import ColorPicker from '../../../components/ui/ColorPicker';
import { useToast } from '../../../components/ui/Toast';
import { useTenant } from '../../../context/TenantContext';
import SchoolSite, { SOCIAL_LABELS, assetUrl } from '../components/SchoolSite';
import TemplatePicker from '../components/TemplatePicker';
import SectionsEditor from '../components/SectionsEditor';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const SOCIAL_HINTS = {
  facebook: 'https://facebook.com/tu-colegio',
  instagram: 'https://instagram.com/tu-colegio',
  x: 'https://x.com/tu-colegio',
  youtube: 'https://youtube.com/@tu-colegio',
  tiktok: 'https://tiktok.com/@tu-colegio',
  whatsapp: 'https://wa.me/584141234567',
  website: 'https://www.tu-colegio.edu.ve',
};
const PREVIEW_WIDTH = { desktop: 1200, mobile: 390 };

/** Lo editable del sitio, tal como se envía a PUT /website. */
const draftFrom = (d) => ({
  slug: d.slug.custom || '',
  tagline: d.site.tagline || '',
  primary_color: d.site.primary_color || '',
  secondary_color: d.site.secondary_color || '',
  banner_url: d.site.banner_url || '',
  history: d.site.history || '',
  mission: d.site.mission || '',
  vision: d.site.vision || '',
  gallery: d.site.gallery || [],
  gallery_autoplay: Boolean(d.site.gallery_autoplay),
  social: d.site.social || {},
  show_contact: d.site.show_contact !== false,
  template: d.site.template || 'classic',
  sections: (d.site.sections || []).map((s) => ({ id: s.id, title: s.title || '', body_html: s.body_html || '', image_url: s.image_url || null, visible: s.visible !== false })),
});

/** "Ponle un nombre al archivo" sin tildes ni espacios: la sugerencia de dirección personalizada. */
const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** Vista previa a escala: el sitio se dibuja a su ancho real (escritorio o móvil) y se reduce para caber. */
function Preview({ school, site, device, intake, events, intakeHref }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const measure = () =>
      setBox({
        w: boxRef.current?.clientWidth || 0,
        h: innerRef.current?.scrollHeight || 0,
      });
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    measure();
    return () => ro.disconnect();
  }, [device]);
  const width = PREVIEW_WIDTH[device];
  const scale = box.w ? Math.min(1, box.w / width) : 1;
  return (
    <div ref={boxRef} className={`web-preview web-preview--${device}`} style={{ height: Math.min(box.h * scale, 1400) || undefined }}>
      <div ref={innerRef} className="web-preview__inner" style={{ width, transform: `scale(${scale})` }}>
        <SchoolSite school={school} site={site} preview intake={intake} events={events} intakeHref={intakeHref} />
      </div>
    </div>
  );
}

/** Sube una imagen y devuelve su URL; el input se reinicia para poder elegir la misma otra vez. */
function useUpload(onUploaded) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) onUploaded((await websiteApi.uploadImage(file)).url);
    } catch (err) {
      toast.error('No se pudo subir la imagen', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return [busy, upload];
}

/**
 * Administración → Sitio web: el mini-sitio público del colegio. A la izquierda
 * se edita; a la derecha, la vista previa en vivo es la misma página que verá el
 * público (SchoolSite). Arriba, la dirección pública para copiar y compartir.
 */
function WebsiteEditorPage() {
  const { data, setData, loading, error } = useFetch(() => websiteApi.get(), []);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [device, setDevice] = useState('desktop');
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const { refreshTenant } = useTenant();
  const bannerRef = useRef(null);
  const galleryRef = useRef(null);
  const logoRef = useRef(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (data && !draft) setDraft(draftFrom(data));
  }, [data, draft]);

  const dirty = useMemo(() => Boolean(data && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(data))), [data, draft]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const [uploadingBanner, uploadBanner] = useUpload((url) => set({ banner_url: url }));
  const [uploadingGallery, uploadGallery] = useUpload((url) =>
    setDraft((d) => ({
      ...d,
      gallery: [...d.gallery, { url, caption: '' }].slice(0, data.limits.gallery),
    })),
  );

  if (loading || (!draft && !error)) return <Spinner label="Cargando el sitio…" />;
  if (error) return <Alert>{error}</Alert>;

  const slugValue = draft.slug.trim().toLowerCase();
  const slugError = errors.slug || (slugValue && !SLUG_RE.test(slugValue) ? 'Solo letras minúsculas, números y guiones (sin espacios ni tildes).' : null);
  const currentSlug = slugValue && !slugError ? slugValue : data.slug.default;
  const savedUrl = `${window.location.origin}/colegio/${data.slug.current}`;
  const published = data.site.is_published;
  // Vista previa: lo que se está editando, con los colores del colegio si no se eligen otros.
  const previewSite = {
    ...draft,
    primary_color: draft.primary_color || data.school.primary_color,
    secondary_color: draft.secondary_color || data.school.secondary_color,
  };
  const previewSchool = draft.show_contact ? data.school : { ...data.school, phone: null, email: null, address: null };

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const saved = await websiteApi.save({
        ...draft,
        slug: slugValue || null,
      });
      setData(saved);
      setDraft(draftFrom(saved));
      toast.success('Sitio guardado', published ? 'Los cambios ya se ven en la página pública.' : 'Publícalo cuando esté listo.');
      return saved;
    } catch (err) {
      setErrors(getFieldErrors(err));
      toast.error('No se pudo guardar el sitio', getErrorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    // Publicar publica lo guardado: si hay cambios, se guardan antes.
    if (!published && dirty && !(await save())) return;
    setPublishing(true);
    try {
      const saved = await websiteApi.setPublished(!published);
      setData(saved);
      toast.success(saved.site.is_published ? 'Sitio publicado' : 'Sitio retirado', saved.site.is_published ? 'Cualquiera con el enlace puede verlo.' : 'La dirección ya no muestra la página.');
    } catch (err) {
      toast.error('No se pudo cambiar la publicación', getErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(savedUrl);
    } catch {
      // Sin permiso de portapapeles: se selecciona el texto para copiarlo a mano.
      document.getElementById('web-url')?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Logo oficial: se guarda al instante (es el de todo el sistema, no un borrador del sitio).
  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    try {
      const res = await websiteApi.uploadLogo(file);
      // Solo cambia el logo: lo demás del editor (y sus cambios sin guardar) sigue igual.
      setData((d) => ({ ...d, school: res.school }));
      refreshTenant?.();
      toast.success('Logo actualizado', 'Es el logo oficial del colegio: se ve en el sitio, el menú y los documentos.');
    } catch (err) {
      toast.error('No se pudo cambiar el logo', getErrorMessage(err));
    } finally {
      setUploadingLogo(false);
    }
  };
  const uploadSectionImage = async (file) => {
    try {
      return (await websiteApi.uploadImage(file)).url;
    } catch (err) {
      toast.error('No se pudo subir la imagen', getErrorMessage(err));
      return null;
    }
  };

  const moveGallery = (i, delta) =>
    setDraft((d) => {
      const g = [...d.gallery];
      const [item] = g.splice(i, 1);
      g.splice(i + delta, 0, item);
      return { ...d, gallery: g };
    });

  return (
    <div>
      <PageHeader
        title="Sitio web del colegio"
        subtitle="Una página pública para presentar el colegio y compartir su enlace. Los cambios se ven al instante en la vista previa."
        actions={
          <>
            <Button variant={published ? 'secondary' : 'primary'} icon={published ? 'lock' : 'send'} onClick={togglePublish} loading={publishing} disabled={saving}>
              {published ? 'Retirar del público' : dirty ? 'Guardar y publicar' : 'Publicar sitio'}
            </Button>
            <Button icon="check" onClick={save} loading={saving} disabled={!dirty || Boolean(slugError)}>
              Guardar
            </Button>
          </>
        }
      />

      <section className={`card web-url ${published ? 'is-live' : ''}`}>
        <div className="web-url__status">
          <span className={`cert-status__dot ${published ? 'is-on' : ''}`} aria-hidden="true" />
          <strong>{published ? 'Publicado' : 'Sin publicar'}</strong>
          <span className="text-sm text-muted">{published ? 'Cualquiera con el enlace puede verlo.' : 'Solo tú lo ves en la vista previa.'}</span>
        </div>
        <div className="web-url__row">
          <input id="web-url" className="input web-url__input" value={savedUrl} readOnly aria-label="Dirección pública del sitio" onFocus={(e) => e.target.select()} />
          <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={copy}>
            {copied ? 'Copiado' : 'Copiar enlace'}
          </Button>
          {published && (
            <a className="btn btn--secondary" href={savedUrl} target="_blank" rel="noreferrer">
              Abrir <Icon name="arrowRight" size={15} />
            </a>
          )}
        </div>
        {dirty && slugValue !== (data.slug.custom || '') && <p className="text-sm text-muted">La dirección nueva se activa al guardar.</p>}
      </section>

      <div className="web-editor">
        <div className="web-editor__form">
          <section className="card web-card">
            <h3 className="card__title">Dirección</h3>
            <Field label="Dirección personalizada" hint={`Vacía: se usa la del colegio («${data.slug.default}»). Solo minúsculas, números y guiones.`} error={slugError}>
              <div className="web-slug">
                <span>/colegio/</span>
                <Input value={draft.slug} onChange={(e) => set({ slug: e.target.value })} placeholder={data.slug.default} maxLength={60} />
              </div>
            </Field>
            {!draft.slug && (
              <button type="button" className="link-button" onClick={() => set({ slug: slugify(data.school.name) })}>
                Usar «{slugify(data.school.name)}»
              </button>
            )}
          </section>

          <section className="card web-card">
            <h3 className="card__title">Plantilla de diseño</h3>
            <p className="text-sm text-muted">Cambia la distribución de la página: el contenido es el mismo en todas.</p>
            <TemplatePicker value={draft.template} onChange={(template) => set({ template })} />
          </section>

          <section className="card web-card">
            <h3 className="card__title">Portada</h3>
            <Field label="Logo del colegio" hint="El logo oficial (el mismo de Configuración → General). PNG o JPG, hasta 2 MB. Se guarda al instante.">
              <div className="web-logo">
                <span className="web-logo__box">{data.school.logo_url ? <img src={assetUrl(data.school.logo_url)} alt="Logo del colegio" /> : <Icon name="image" size={22} />}</span>
                <Button size="sm" variant="secondary" icon="upload" onClick={() => logoRef.current?.click()} loading={uploadingLogo}>
                  {data.school.logo_url ? 'Cambiar logo' : 'Subir logo'}
                </Button>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg" hidden onChange={uploadLogo} />
              </div>
            </Field>
            <Field label="Eslogan" hint={`${draft.tagline.length}/160`} error={errors.tagline}>
              <Input value={draft.tagline} onChange={(e) => set({ tagline: e.target.value })} maxLength={160} placeholder="Ej.: Educando con valores desde 1985" />
            </Field>
            <Field label="Imagen de portada" hint="Una foto horizontal del colegio. PNG, JPG o WebP, hasta 3 MB.">
              <div className="web-banner">
                {draft.banner_url ? <img src={assetUrl(draft.banner_url)} alt="" /> : <span className="web-banner__empty">Sin imagen: se usa el color principal</span>}
                <span className="web-banner__actions">
                  <Button size="sm" variant="secondary" icon="upload" onClick={() => bannerRef.current?.click()} loading={uploadingBanner}>
                    {draft.banner_url ? 'Cambiar' : 'Subir imagen'}
                  </Button>
                  {draft.banner_url && (
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => set({ banner_url: '' })}>
                      Quitar
                    </Button>
                  )}
                </span>
                <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={uploadBanner} />
              </div>
            </Field>
            <p className="text-sm text-muted">El nombre del colegio es el de Configuración → General.</p>
            <div className="web-colors">
              <Field label="Color principal" hint={draft.primary_color ? '' : 'El del colegio'}>
                <ColorPicker label="Color principal del sitio" value={draft.primary_color || data.school.primary_color} onChange={(c) => set({ primary_color: c })} />
              </Field>
              <Field label="Color secundario" hint={draft.secondary_color ? '' : 'El del colegio'}>
                <ColorPicker label="Color secundario del sitio" value={draft.secondary_color || data.school.secondary_color} onChange={(c) => set({ secondary_color: c })} />
              </Field>
              {(draft.primary_color || draft.secondary_color) && (
                <button type="button" className="link-button" onClick={() => set({ primary_color: '', secondary_color: '' })}>
                  Usar los colores del colegio
                </button>
              )}
            </div>
          </section>

          <section className="card web-card">
            <h3 className="card__title">Nosotros</h3>
            <Field label="Reseña histórica" hint={`Deja una línea en blanco entre párrafos. ${draft.history.length}/6000`} error={errors.history}>
              <textarea
                className="input web-textarea"
                rows={6}
                maxLength={6000}
                value={draft.history}
                onChange={(e) => set({ history: e.target.value })}
                placeholder="Cómo nació el colegio, sus fundadores, sus logros…"
              />
            </Field>
            <Field label="Misión" hint={`${draft.mission.length}/3000`} error={errors.mission}>
              <textarea className="input web-textarea" rows={3} maxLength={3000} value={draft.mission} onChange={(e) => set({ mission: e.target.value })} />
            </Field>
            <Field label="Visión" hint={`${draft.vision.length}/3000`} error={errors.vision}>
              <textarea className="input web-textarea" rows={3} maxLength={3000} value={draft.vision} onChange={(e) => set({ vision: e.target.value })} />
            </Field>
          </section>

          <section className="card web-card">
            <h3 className="card__title">Secciones adicionales</h3>
            <SectionsEditor sections={draft.sections} onChange={(sections) => set({ sections })} max={data.limits.sections} uploadImage={uploadSectionImage} errors={errors} />
          </section>

          <section className="card web-card">
            <h3 className="card__title">Próximos eventos</h3>
            <p className="text-sm text-muted">
              Se llena solo desde <strong>Eventos y cartelera</strong>: aparecen los eventos publicados que tengan activada «Mostrar en el sitio web del colegio», del más
              cercano al más lejano, hasta que terminan. Crear, editar o borrar un evento cambia la página al instante.
            </p>
            <div className="web-events">
              <span className={`web-events__count ${data.events?.length ? 'is-on' : ''}`}>
                <Icon name="calendar" size={16} />
                {data.events?.length
                  ? `${data.events.length} ${data.events.length === 1 ? 'evento se muestra' : 'eventos se muestran'} en la página`
                  : 'Ningún evento marcado: la sección no aparece'}
              </span>
              <Link to="/events" className="btn btn--secondary btn--sm">
                Ir a la cartelera <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </section>

          <section className="card web-card">
            <div className="web-card__head">
              <h3 className="card__title">Galería</h3>
              <Button size="sm" variant="secondary" icon="upload" onClick={() => galleryRef.current?.click()} loading={uploadingGallery} disabled={draft.gallery.length >= data.limits.gallery}>
                Agregar fotos
              </Button>
              <input ref={galleryRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={uploadGallery} />
            </div>
            {draft.gallery.length === 0 ? (
              <p className="text-sm text-muted">Sin fotos todavía. Puedes subir varias a la vez (hasta {data.limits.gallery}).</p>
            ) : (
              <ul className="web-gallery">
                {draft.gallery.map((g, i) => (
                  <li key={`${g.url}-${i}`}>
                    <img src={assetUrl(g.url)} alt="" />
                    <Input
                      value={g.caption}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          gallery: d.gallery.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)),
                        }))
                      }
                      maxLength={140}
                      placeholder="Pie de foto (opcional)"
                      aria-label={`Pie de la foto ${i + 1}`}
                    />
                    <span className="ep-row__actions">
                      <button type="button" className="ep-icon" onClick={() => moveGallery(i, -1)} disabled={i === 0} title="Antes" aria-label={`Mover la foto ${i + 1} antes`}>
                        <Icon name="chevronUp" size={15} />
                      </button>
                      <button
                        type="button"
                        className="ep-icon"
                        onClick={() => moveGallery(i, 1)}
                        disabled={i === draft.gallery.length - 1}
                        title="Después"
                        aria-label={`Mover la foto ${i + 1} después`}
                      >
                        <Icon name="chevronDown" size={15} />
                      </button>
                      <button
                        type="button"
                        className="ep-icon is-danger"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            gallery: d.gallery.filter((_, k) => k !== i),
                          }))
                        }
                        title="Quitar"
                        aria-label={`Quitar la foto ${i + 1}`}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {draft.gallery.length > 1 && (
              <label className="web-check">
                <input type="checkbox" checked={draft.gallery_autoplay} onChange={(e) => set({ gallery_autoplay: e.target.checked })} />
                <span>
                  Avanzar las fotos automáticamente
                  <small>El carrusel pasa solo cada 5 segundos. Se detiene al pasar el mouse por encima o con el botón de pausa, y no se mueve si el visitante tiene activado «reducir movimiento».</small>
                </span>
              </label>
            )}
          </section>

          <section className="card web-card">
            <h3 className="card__title">Contacto y redes sociales</h3>
            <label className="web-check">
              <input type="checkbox" checked={draft.show_contact} onChange={(e) => set({ show_contact: e.target.checked })} />
              <span>
                Mostrar teléfono, correo y dirección del colegio
                <small>{[data.school.phone, data.school.email, data.school.address].filter(Boolean).join(' · ') || 'No hay datos de contacto en Configuración → General.'}</small>
              </span>
            </label>
            <div className="web-social">
              {data.limits.social.map((k) => (
                <Field key={k} label={SOCIAL_LABELS[k]} error={errors[`social.${k}`]}>
                  <Input type="url" value={draft.social[k] || ''} onChange={(e) => set({ social: { ...draft.social, [k]: e.target.value } })} placeholder={SOCIAL_HINTS[k]} maxLength={300} />
                </Field>
              ))}
            </div>
          </section>
        </div>

        <aside className="web-editor__preview">
          <div className="web-preview__bar">
            <span className="text-sm text-muted">
              <Icon name="eye" size={14} /> Vista previa {dirty && '· con cambios sin guardar'}
            </span>
            <div className="segmented" role="radiogroup" aria-label="Dispositivo">
              {[
                ['desktop', 'Escritorio'],
                ['mobile', 'Móvil'],
              ].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={device === k} className={`segmented__item ${device === k ? 'segmented__item--active' : ''}`} onClick={() => setDevice(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="web-preview__url">
            <span>/colegio/{currentSlug}</span>
          </div>
          <Preview school={previewSchool} site={previewSite} device={device} intake={data.intake} events={data.events || []} intakeHref={`/colegio/${data.slug.current}/solicitud`} />
        </aside>
      </div>
    </div>
  );
}

export default WebsiteEditorPage;
