import { useRef, useState } from 'react';
import Button from '../../../components/ui/Button';
import Field from '../../../components/ui/Field';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/ui/Icon';
import RichTextEditor from '../../../components/ui/RichTextEditor';
import { assetUrl } from './SchoolSite';

/** Puntos de partida habituales (se pueden editar por completo). */
const PRESETS = [
  { title: 'Oferta académica', body_html: '<p>Educación Inicial, Primaria y Media General.</p><ul><li>Horario de 7:00 a. m. a 12:30 p. m.</li><li>Inglés desde Inicial</li></ul>' },
  { title: 'Actividades extracurriculares', body_html: '<p>Deportes, música, teatro y robótica para todas las edades.</p>' },
  { title: 'Inscripciones', body_html: '<p>Conoce los requisitos y las fechas del proceso de inscripción.</p>' },
  { title: '', body_html: '' },
];

const newSection = (preset) => ({ id: crypto.randomUUID(), title: preset.title, body_html: preset.body_html, image_url: null, visible: true });

/**
 * Secciones adicionales del sitio: título, texto con formato, imagen opcional,
 * visibles u ocultas, en el orden en que aparecen (flechas para moverlas).
 *   sections  [{ id, title, body_html, image_url, visible }]
 *   uploadImage  async (file) => url
 */
function SectionsEditor({ sections, onChange, max, uploadImage, errors = {} }) {
  const fileRefs = useRef({});
  const [busy, setBusy] = useState(null);
  const patch = (id, values) => onChange(sections.map((s) => (s.id === id ? { ...s, ...values } : s)));
  const move = (i, delta) => {
    const next = [...sections];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    onChange(next);
  };
  const pickImage = async (id, e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(id);
    try {
      const url = await uploadImage(file);
      if (url) patch(id, { image_url: url });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="web-sections">
      {sections.length === 0 && <p className="text-sm text-muted">Agrega bloques propios: oferta académica, actividades, inscripciones… Aparecen en el orden de esta lista.</p>}
      {sections.map((s, i) => (
        <article key={s.id} className={`web-section ${s.visible ? '' : 'is-hidden'}`}>
          <header className="web-section__head">
            <span className="web-section__n">{i + 1}</span>
            <strong>{s.title || 'Sección sin título'}</strong>
            <span className="ep-row__actions">
              <button type="button" className="ep-icon" onClick={() => patch(s.id, { visible: !s.visible })} title={s.visible ? 'Ocultar' : 'Mostrar'} aria-label={`${s.visible ? 'Ocultar' : 'Mostrar'} la sección ${i + 1}`} aria-pressed={!s.visible}>
                <Icon name={s.visible ? 'eye' : 'lock'} size={15} />
              </button>
              <button type="button" className="ep-icon" onClick={() => move(i, -1)} disabled={i === 0} title="Subir" aria-label={`Subir la sección ${i + 1}`}>
                <Icon name="chevronUp" size={15} />
              </button>
              <button type="button" className="ep-icon" onClick={() => move(i, 1)} disabled={i === sections.length - 1} title="Bajar" aria-label={`Bajar la sección ${i + 1}`}>
                <Icon name="chevronDown" size={15} />
              </button>
              <button type="button" className="ep-icon is-danger" onClick={() => onChange(sections.filter((x) => x.id !== s.id))} title="Quitar" aria-label={`Quitar la sección ${i + 1}`}>
                <Icon name="trash" size={15} />
              </button>
            </span>
          </header>
          {!s.visible && <p className="text-sm text-muted">Oculta: no aparece en la página pública.</p>}
          <Field label="Título" error={errors[`sections.${i}.title`]}>
            <Input value={s.title} onChange={(e) => patch(s.id, { title: e.target.value })} maxLength={120} placeholder="Ej.: Oferta académica" />
          </Field>
          <Field label="Contenido">
            <RichTextEditor value={s.body_html} onChange={(html) => patch(s.id, { body_html: html })} allowImages={false} placeholder="Escribe el contenido de la sección…" ariaLabel={`Contenido de la sección ${i + 1}`} minHeight={120} />
          </Field>
          <div className="web-section__image">
            {s.image_url ? <img src={assetUrl(s.image_url)} alt="" /> : <span className="text-sm text-muted">Sin imagen (opcional)</span>}
            <span className="web-banner__actions">
              <Button size="sm" variant="secondary" icon="upload" onClick={() => fileRefs.current[s.id]?.click()} loading={busy === s.id}>
                {s.image_url ? 'Cambiar imagen' : 'Agregar imagen'}
              </Button>
              {s.image_url && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => patch(s.id, { image_url: null })}>
                  Quitar
                </Button>
              )}
            </span>
            <input
              ref={(el) => {
                fileRefs.current[s.id] = el;
              }}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => pickImage(s.id, e)}
            />
          </div>
        </article>
      ))}
      {sections.length < max && (
        <div className="web-sections__add">
          <span className="text-sm text-muted">Agregar:</span>
          {PRESETS.map((p) => (
            <Button key={p.title || 'blank'} size="sm" variant="secondary" icon="plus" onClick={() => onChange([...sections, newSection(p)])}>
              {p.title || 'Sección en blanco'}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SectionsEditor;
