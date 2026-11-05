import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * Editor de texto enriquecido liviano (sin dependencias): área editable con
 * barra de herramientas agrupada —
 *   [Párrafo/Títulos] · [B I U S] · [color, resaltado] · [listas] · [enlace, imagen] · [alineación] · [limpiar]
 *
 *   value          HTML inicial (se lee al montar)
 *   onChange       (html) => void en cada cambio
 *   onUploadImage  async (file) => url   — sin él, la imagen solo se inserta por URL
 *
 * Lo que produce se SANEA en el servidor (lista blanca). Aquí además se pega
 * siempre como texto plano, para no arrastrar estilos de Word o de la web.
 */

const API_ORIGIN = import.meta.env.VITE_API_URL || '';
/** Las imágenes subidas se guardan como /storage/…; si la API vive en otro dominio, se antepone. */
export const assetUrl = (src) => (src && src.startsWith('/storage/') ? `${API_ORIGIN}${src}` : src);
/** Inverso: al emitir el HTML, las rutas propias vuelven a ser relativas (así las acepta el servidor). */
const toStoredHtml = (html) => (API_ORIGIN ? html.split(`src="${API_ORIGIN}/storage/`).join('src="/storage/') : html);

const BLOCKS = [
  { value: 'p', label: 'Párrafo' },
  { value: 'h1', label: 'Título 1' },
  { value: 'h2', label: 'Título 2' },
  { value: 'h3', label: 'Título 3' },
];
const TEXT_COLORS = ['#0f172a', '#475569', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];
const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#e9d5ff', '#fbcfe8'];

const GROUPS = [
  [
    { cmd: 'bold', icon: 'bold', label: 'Negrita (Ctrl+B)' },
    { cmd: 'italic', icon: 'italic', label: 'Cursiva (Ctrl+I)' },
    { cmd: 'underline', icon: 'underline', label: 'Subrayado (Ctrl+U)' },
    { cmd: 'strikeThrough', icon: 'strikethrough', label: 'Tachado' },
  ],
  [
    { pop: 'color', icon: 'textColor', label: 'Color del texto' },
    { pop: 'highlight', icon: 'highlighter', label: 'Resaltado' },
  ],
  [
    { cmd: 'insertUnorderedList', icon: 'listBullet', label: 'Lista con viñetas' },
    { cmd: 'insertOrderedList', icon: 'listOrdered', label: 'Lista numerada' },
  ],
  [
    { pop: 'link', icon: 'link', label: 'Enlace' },
    { pop: 'image', icon: 'image', label: 'Insertar imagen' },
  ],
  [
    { cmd: 'justifyLeft', icon: 'alignLeft', label: 'Alinear a la izquierda' },
    { cmd: 'justifyCenter', icon: 'alignCenter', label: 'Centrar' },
    { cmd: 'justifyRight', icon: 'alignRight', label: 'Alinear a la derecha' },
    { cmd: 'justifyFull', icon: 'alignJustify', label: 'Justificar' },
  ],
  [{ cmd: 'removeFormat', icon: 'eraser', label: 'Quitar formato' }],
];
const STATEFUL = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];

function RichTextEditor({ value = '', onChange, onUploadImage, placeholder = 'Escribe el mensaje…', ariaLabel = 'Mensaje', invalid = false, minHeight = 200 }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const savedRange = useRef(null);
  const [active, setActive] = useState({});
  const [block, setBlock] = useState('p');
  const [pop, setPop] = useState(null); // 'color' | 'highlight' | 'link' | 'image'
  const [empty, setEmpty] = useState(!value);
  const [lastColor, setLastColor] = useState({ color: '#dc2626', highlight: '#fef08a' });

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = value || '';
      ref.current.querySelectorAll('img').forEach((img) => img.setAttribute('src', assetUrl(img.getAttribute('src'))));
    }
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p'); // Enter → <p>, no <div>
      document.execCommand('styleWithCSS', false, true); // colores como style="", no <font>
    } catch {
      // navegadores sin soporte: el servidor normaliza
    }
    // Solo al montar: el editor es no controlado mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cerrar los paneles al hacer clic fuera.
  useEffect(() => {
    if (!pop) return undefined;
    const onDown = (e) => !wrapRef.current?.contains(e.target) && setPop(null);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pop]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    setEmpty(!el.textContent.trim() && !el.querySelector('li, img'));
    onChange?.(toStoredHtml(el.innerHTML));
  };

  // Estado de los botones según la selección.
  useEffect(() => {
    const update = () => {
      const sel = document.getSelection();
      if (!ref.current || !sel?.anchorNode || !ref.current.contains(sel.anchorNode)) return;
      // La última selección dentro del editor (para volver a ella tras usar un panel).
      if (sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange();
      const next = {};
      STATEFUL.forEach((c) => {
        try {
          next[c] = document.queryCommandState(c);
        } catch {
          next[c] = false;
        }
      });
      setActive(next);
      try {
        const v = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
        setBlock(BLOCKS.some((b) => b.value === v) ? v : 'p');
      } catch {
        setBlock('p');
      }
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  const saveSelection = () => {
    const sel = document.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const sel = document.getSelection();
    // Si la selección sigue dentro del editor, es la buena: no se reemplaza por una guardada antes.
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) {
      ref.current.focus();
      return;
    }
    ref.current?.focus();
    if (!sel) return;
    sel.removeAllRanges();
    if (savedRange.current) sel.addRange(savedRange.current);
    else {
      // Sin selección previa: al final del texto.
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      r.collapse(false);
      sel.addRange(r);
    }
  };
  const exec = (cmd, arg) => {
    restoreSelection();
    try {
      document.execCommand('styleWithCSS', false, true);
    } catch {
      // ignorado
    }
    document.execCommand(cmd, false, arg);
    saveSelection();
    emit();
  };

  const onTool = (t) => {
    if (t.pop) {
      saveSelection();
      setPop((p) => (p === t.pop ? null : t.pop));
      return;
    }
    ref.current?.focus();
    document.execCommand(t.cmd, false);
    emit();
  };

  const onBlock = (value) => {
    exec('formatBlock', `<${value}>`);
    setBlock(value);
  };

  const applyColor = (kind, color) => {
    if (color) setLastColor((c) => ({ ...c, [kind]: color }));
    // «Sin color»: valores que el servidor descarta (vuelve al color normal).
    if (kind === 'color') exec('foreColor', color || 'inherit');
    else {
      restoreSelection();
      // hiliteColor (Chrome/Firefox) y backColor (Safari) aplican el resaltado.
      if (!document.execCommand('hiliteColor', false, color || 'transparent')) document.execCommand('backColor', false, color || 'transparent');
      saveSelection();
      emit();
    }
    setPop(null);
  };

  const insertLink = (raw) => {
    const url = /^(https?:|mailto:|tel:)/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    restoreSelection();
    const sel = document.getSelection();
    if (raw && raw !== 'https://') {
      if (sel && sel.isCollapsed) {
        document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
      } else {
        document.execCommand('createLink', false, url);
      }
    } else {
      document.execCommand('unlink', false);
    }
    setPop(null);
    emit();
  };

  const insertImage = (src, alt = '') => {
    restoreSelection();
    document.execCommand('insertHTML', false, `<img src="${assetUrl(src).replace(/"/g, '&quot;')}" alt="${alt.replace(/"/g, '&quot;')}">`);
    setPop(null);
    emit();
  };

  const onPaste = (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  return (
    <div ref={wrapRef} className={`rte ${invalid ? 'rte--invalid' : ''}`}>
      <div className="rte__toolbar" role="toolbar" aria-label="Formato del texto">
        <div className="rte__group">
          <select
            className="rte__block"
            value={block}
            onMouseDown={saveSelection}
            onChange={(e) => onBlock(e.target.value)}
            aria-label="Tipo de texto"
            title="Párrafo o título"
          >
            {BLOCKS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        {GROUPS.map((group, gi) => (
          <div key={gi} className="rte__group">
            {group.map((t) => (
              <button
                key={t.cmd || t.pop}
                type="button"
                className={`rte__btn ${active[t.cmd] || pop === t.pop ? 'is-active' : ''}`}
                // mousedown + preventDefault: el botón no le roba la selección al texto.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onTool(t);
                }}
                title={t.label}
                aria-label={t.label}
                aria-pressed={t.cmd && STATEFUL.includes(t.cmd) ? Boolean(active[t.cmd]) : undefined}
                aria-expanded={t.pop ? pop === t.pop : undefined}
              >
                <Icon name={t.icon} size={16} />
                {t.pop === 'color' && <span className="rte__swatch-bar" style={{ background: lastColor.color }} />}
                {t.pop === 'highlight' && <span className="rte__swatch-bar" style={{ background: lastColor.highlight }} />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {(pop === 'color' || pop === 'highlight') && (
        <div className="rte__panel" role="dialog" aria-label={pop === 'color' ? 'Color del texto' : 'Color de resaltado'}>
          <span className="rte__panel-title">{pop === 'color' ? 'Color del texto' : 'Resaltado'}</span>
          <div className="rte__swatches">
            {(pop === 'color' ? TEXT_COLORS : HIGHLIGHTS).map((c) => (
              <button
                key={c}
                type="button"
                className="rte__swatch"
                style={{ background: c }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyColor(pop, c);
                }}
                aria-label={`Color ${c}`}
                title={c}
              />
            ))}
          </div>
          <button
            type="button"
            className="rte__panel-link"
            onMouseDown={(e) => {
              e.preventDefault();
              applyColor(pop, null);
            }}
          >
            {pop === 'color' ? 'Color normal' : 'Sin resaltado'}
          </button>
        </div>
      )}
      {pop === 'link' && <LinkPanel onApply={insertLink} onCancel={() => setPop(null)} initial={savedRange.current?.startContainer?.parentElement?.closest?.('a')?.getAttribute('href')} />}
      {pop === 'image' && <ImagePanel onInsert={insertImage} onCancel={() => setPop(null)} onUpload={onUploadImage} />}

      <div
        ref={ref}
        className={`rte__area ${empty ? 'is-empty' : ''}`}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onBlur={() => {
          saveSelection();
          emit();
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onPaste={onPaste}
        suppressContentEditableWarning
      />
    </div>
  );
}

function LinkPanel({ initial, onApply, onCancel }) {
  const [url, setUrl] = useState(initial || 'https://');
  return (
    <form
      className="rte__panel rte__panel--row"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(url.trim());
      }}
    >
      <Icon name="link" size={15} />
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Dirección del enlace" autoFocus />
      <button type="submit" className="rte__ok">
        Aplicar
      </button>
      <button type="button" className="rte__cancel" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}

/** Imagen: subir un archivo (PNG, JPG, GIF o WebP hasta 3 MB) o pegar una dirección https. */
function ImagePanel({ onInsert, onCancel, onUpload }) {
  const [tab, setTab] = useState(onUpload ? 'upload' : 'url');
  const [url, setUrl] = useState('https://');
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return setError('Usa una imagen PNG, JPG, GIF o WebP.');
    if (file.size > 3 * 1024 * 1024) return setError('La imagen no puede pesar más de 3 MB.');
    setBusy(true);
    setError(null);
    try {
      const { url: stored } = await onUpload(file);
      onInsert(stored, alt.trim() || file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setError(err?.response?.data?.error?.message || err.message || 'No se pudo subir la imagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rte__panel rte__panel--image" role="dialog" aria-label="Insertar imagen">
      <div className="rte__tabs" role="tablist">
        {onUpload && (
          <button type="button" role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'is-active' : ''} onClick={() => setTab('upload')}>
            Subir archivo
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'url'} className={tab === 'url' ? 'is-active' : ''} onClick={() => setTab('url')}>
          Desde una dirección
        </button>
      </div>
      <input type="text" className="rte__input" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Descripción de la imagen (opcional)" aria-label="Descripción de la imagen" />
      {tab === 'upload' ? (
        <div
          className={`rte__drop ${busy ? 'is-busy' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="image" size={22} />
          <span>{busy ? 'Subiendo…' : 'Arrastra aquí la imagen o'}</span>
          <button type="button" className="rte__ok" onClick={() => fileRef.current?.click()} disabled={busy}>
            Elegir archivo
          </button>
          <span className="rte__hint">PNG, JPG, GIF o WebP · hasta 3 MB</span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
      ) : (
        <form
          className="rte__panel-row"
          onSubmit={(e) => {
            e.preventDefault();
            const v = url.trim();
            if (!/^https:\/\/\S+$/i.test(v)) return setError('Usa una dirección segura que empiece con https://');
            onInsert(v, alt.trim());
          }}
        >
          <input type="text" className="rte__input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/cartel.jpg" aria-label="Dirección de la imagen" autoFocus />
          <button type="submit" className="rte__ok">
            Insertar
          </button>
        </form>
      )}
      {error && <span className="rte__error">{error}</span>}
      <button type="button" className="rte__cancel rte__cancel--end" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

export default RichTextEditor;
